#!/usr/bin/env perl
# run-limited.pl SECONDS CMD [ARGS...]
#
# Runs CMD and fails it if it takes longer than SECONDS: the payload self-tests run under it so a
# test that hangs fails within minutes, by name, with a stack sample, instead of silently eating
# the CI job's 20-minute limit (twice in October 2026 a macOS runner hung there; a cancelled job
# keeps no log, so which test hung could never be told).
#
# On a timeout it prints which command it was, samples its stacks (macOS `sample`; Linux
# `eu-stack` or `gdb` when present), then TERMs and KILLs it, and exits 124 like timeout(1).
use strict;
use warnings;
use POSIX ":sys_wait_h";

my $limit = shift @ARGV;
die "usage: run-limited.pl SECONDS CMD [ARGS...]\n" unless defined $limit && $limit =~ /^\d+$/ && @ARGV;
my @cmd = @ARGV;

my $pid = fork() // die "fork: $!";
if ($pid == 0) {
    setpgrp(0, 0);    # its own group, so a timeout reaches the children it started
    exec @cmd or die "exec $cmd[0]: $!\n";
}

my $deadline = time + $limit;
while (1) {
    my $done = waitpid($pid, WNOHANG);
    if ($done == $pid) {
        exit($? & 127 ? 128 + ($? & 127) : $? >> 8);
    }
    last if time >= $deadline;
    select(undef, undef, undef, 0.2);
}

print STDERR "\n::error::TIMEOUT after ${limit}s: @cmd\n";
my @procs = ($pid);
if (open(my $ps, "-|", "ps", "-o", "pid=", "-g", $pid)) {
    while (<$ps>) { s/\s+//g; push @procs, $_ if $_ && $_ != $pid; }
    close $ps;
}
for my $p (@procs) {
    print STDERR "---- stacks of pid $p ----\n";
    if (-x "/usr/bin/sample") {
        system("/usr/bin/sample", $p, "2", "-mayDie");
    } elsif (system("command -v eu-stack >/dev/null 2>&1") == 0) {
        system("eu-stack", "-p", $p);
    } elsif (system("command -v gdb >/dev/null 2>&1") == 0) {
        system("gdb", "-p", $p, "-batch", "-ex", "thread apply all bt");
    }
}
kill "TERM", -$pid;
sleep 2;
kill "KILL", -$pid;
waitpid($pid, 0);
exit 124;
