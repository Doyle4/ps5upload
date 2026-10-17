#![cfg(unix)]
//! Console web UI Task 5: the on-console page runs under its own identity and lists and
//! cancels every job the helper runs, whoever started it (`ava1_jobs_list_all`,
//! `ava1_jobs_owner_is`, `ava1_job_cancel_any`). Paired PCs keep their own-jobs-only view.
mod common;

use std::time::Duration;

use ava1::gen::{self, JobCopy, JobEntry, JobListResult, JobRef, JobRun};
use ava1::session::{connect, Session};
use ava1::wire::Message;
use ava1_ctest::*;
use common::*;

// The C server is a process-wide singleton: run this binary with `--test-threads=1`.

const OP_KIND: u8 = 4;
/// The console page's fixed identity (constraints.md): ASCII, zero-padded to 32 bytes.
const CONSOLE: [u8; 32] = *b"ps5upload-console-webui\0\0\0\0\0\0\0\0\0";

async fn list(s: &Session) -> Vec<JobEntry> {
    let r = s.rpc(gen::METHOD_JOB_LIST, &[]).await.unwrap();
    assert_eq!(r.status, gen::STATUS_OK, "job.list");
    JobListResult::decode(&r.body).unwrap().jobs
}

fn list_all(me: &[u8; 32]) -> Vec<JobEntry> {
    let body = c_jobs_list_all(me).expect("list_all");
    JobListResult::decode(&body).unwrap().jobs
}

async fn code(s: &Session, method: u16, job: [u8; 16]) -> u16 {
    s.rpc(method, &JobRef { job_id: job }.to_bytes().unwrap())
        .await
        .unwrap()
        .status
}

struct Two {
    srv: CServer,
    a: Session,
    a_key: [u8; 32],
    b: Session,
    b_key: [u8; 32],
    d: TempDir,
}

async fn two(tag: &str, fsync_delay_us: u32) -> Two {
    let d = dir(tag);
    let (a_id, a_peers) = paired_client(&d.join("peers"));
    let (b_id, b_peers) = paired_client(&d.join("peers"));
    let (a_key, b_key) = (a_id.public(), b_id.public());
    let srv = CServer::start_data(
        SECRET,
        &d.join("peers"),
        &d.join("jobs"),
        200,
        2000,
        2000,
        fsync_delay_us,
    );
    let a = connect(&srv.addr(), a_id, a_peers, "a", calm())
        .await
        .unwrap();
    let b = connect(&srv.addr(), b_id, b_peers, "b", calm())
        .await
        .unwrap();
    Two {
        srv,
        a,
        a_key,
        b,
        b_key,
        d,
    }
}

async fn run_fsck(s: &Session, job: [u8; 16]) -> u16 {
    let body = JobRun {
        job_id: job,
        op: gen::JOB_OP_FSCK,
        args: br#"{"device":"/dev/md1","loops":30}"#.to_vec(),
    };
    s.rpc(gen::METHOD_JOB_RUN, &body.to_bytes().unwrap())
        .await
        .unwrap()
        .status
}

async fn copy(s: &Session, job: [u8; 16], src: &std::path::Path, dest: &std::path::Path) -> u16 {
    let body = JobCopy {
        job_id: job,
        src: src.to_str().unwrap().into(),
        dest: dest.to_str().unwrap().into(),
        flags: 0,
    };
    s.rpc(gen::METHOD_JOB_COPY, &body.to_bytes().unwrap())
        .await
        .unwrap()
        .status
}

#[tokio::test(flavor = "multi_thread")]
async fn list_all_includes_other_owners_jobs() {
    let t = two("any-list", 0).await;
    let op = [0xa1; 16];
    assert_eq!(run_fsck(&t.a, op).await, gen::STATUS_OK);
    // B, a paired PC, still sees only its own jobs over JOB_LIST.
    assert!(
        list(&t.b).await.is_empty(),
        "JOB_LIST as b lists only b's jobs"
    );
    // The console page sees a's operation, whichever identity asks.
    for me in [&t.b_key, &CONSOLE] {
        let all = list_all(me);
        assert_eq!(all.len(), 1, "list_all shows every owner's job");
        assert_eq!(all[0].job_id, op);
        assert_eq!(all[0].kind, OP_KIND);
    }
    // Ownership is reported beside the list, not in it.
    assert_eq!(c_jobs_owner_is(&op, &t.a_key), 1);
    assert_eq!(c_jobs_owner_is(&op, &t.b_key), 0);
    assert_eq!(c_jobs_owner_is(&op, &CONSOLE), 0);
    assert_eq!(c_jobs_owner_is(&[0xee; 16], &t.a_key), 0, "absent job");
    drop(t.srv);
}

#[tokio::test(flavor = "multi_thread")]
async fn cancel_any_cancels_other_owners_copy() {
    let t = two("any-cancel", 3000).await;
    write_tree(&t.d.join("usb/g"), 3000, |_| 2048);
    let job = [0xa2; 16];
    assert_eq!(
        copy(&t.a, job, &t.d.join("usb/g"), &t.d.join("data/g")).await,
        gen::STATUS_OK
    );
    assert!(list_all(&CONSOLE).iter().any(|e| e.job_id == job));
    // B over the RPC still cannot touch it ...
    assert_eq!(
        code(&t.b, gen::METHOD_JOB_CANCEL, job).await,
        gen::ERR_UNKNOWN_JOB
    );
    // ... the console page can.
    assert_eq!(c_job_cancel_any(&job), gen::STATUS_OK as i32);
    let mut gone = false;
    for _ in 0..200 {
        if code(&t.a, gen::METHOD_JOB_STATUS, job).await == gen::ERR_UNKNOWN_JOB {
            gone = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    assert!(gone, "the cancelled copy is unlisted for its owner");
    assert!(!list_all(&CONSOLE).iter().any(|e| e.job_id == job));
    assert_eq!(c_job_cancel_any(&job), gen::ERR_UNKNOWN_JOB as i32);
    assert_eq!(c_job_cancel_any(&[0xef; 16]), gen::ERR_UNKNOWN_JOB as i32);
    drop(t.srv);
}

#[tokio::test(flavor = "multi_thread")]
async fn job_list_rpc_unchanged_for_pcs() {
    let t = two("any-rpc", 0).await;
    let (ja, jb) = ([0xa3; 16], [0xa4; 16]);
    assert_eq!(run_fsck(&t.a, ja).await, gen::STATUS_OK);
    assert_eq!(run_fsck(&t.b, jb).await, gen::STATUS_OK);
    let la: Vec<_> = list(&t.a).await.iter().map(|e| e.job_id).collect();
    let lb: Vec<_> = list(&t.b).await.iter().map(|e| e.job_id).collect();
    assert_eq!(la, vec![ja]);
    assert_eq!(lb, vec![jb]);
    // Each PC's own status/cancel still works; the other's is still refused.
    assert_eq!(
        code(&t.b, gen::METHOD_JOB_STATUS, ja).await,
        gen::ERR_UNKNOWN_JOB
    );
    assert_eq!(
        code(&t.a, gen::METHOD_JOB_CANCEL, jb).await,
        gen::ERR_UNKNOWN_JOB
    );
    assert_eq!(code(&t.a, gen::METHOD_JOB_CANCEL, ja).await, gen::STATUS_OK);
    assert_eq!(code(&t.b, gen::METHOD_JOB_CANCEL, jb).await, gen::STATUS_OK);
    // The console page sees both.
    let mut all: Vec<_> = list_all(&CONSOLE).iter().map(|e| e.job_id).collect();
    all.sort();
    assert_eq!(all, vec![ja, jb]);
    drop(t.srv);
}
