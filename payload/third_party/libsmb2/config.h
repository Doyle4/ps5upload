/* libsmb2 build configuration for ps5upload (written by hand, not generated): the PS5 (FreeBSD
 * libc from the payload SDK) and the host test builds (macOS, Linux). See README.md. */
#ifndef PS5UPLOAD_LIBSMB2_CONFIG_H
#define PS5UPLOAD_LIBSMB2_CONFIG_H

#define HAVE_ARPA_INET_H 1
#define HAVE_FCNTL_H 1
#define HAVE_INTTYPES_H 1
#define HAVE_NETDB_H 1
#define HAVE_NETINET_IN_H 1
#define HAVE_NETINET_TCP_H 1
#define HAVE_POLL_H 1
#define HAVE_STDINT_H 1
#define HAVE_STDIO_H 1
#define HAVE_STDLIB_H 1
#define HAVE_STRINGS_H 1
#define HAVE_STRING_H 1
#define HAVE_SYS_IOCTL_H 1
#define HAVE_SYS_SOCKET_H 1
#define HAVE_SYS_STAT_H 1
#define HAVE_SYS_TYPES_H 1
#define HAVE_SYS_UIO_H 1
#define HAVE_TIME_H 1
#define HAVE_SYS_TIME_H 1
#define HAVE_UNISTD_H 1
#define HAVE_ERRNO_H 1
#define HAVE_SOCKADDR_STORAGE 1
#define HAVE_STRUCT_ADDRINFO 1
#define HAVE_STRUCT_IOVEC 1
#define HAVE_LINGER 1
#define STDC_HEADERS 1
#if defined(__FreeBSD__) || defined(__APPLE__) || defined(__PROSPERO__)
#define HAVE_SOCKADDR_LEN 1
#define HAVE_SOCK_SIN_LEN 1
#endif
/* The NTLM client challenge and the SMB3 nonces: arc4random_buf on the PS5 (FreeBSD libc) and macOS. */
#if defined(__FreeBSD__) || defined(__APPLE__) || defined(__PROSPERO__)
#define HAVE_ARC4RANDOM_BUF 1
#else
#define HAVE_DEV_URANDOM 1
#endif

/* aes128ccm.c marks scratch buffers with _U_; upstream leaves it to the build to define. */
#ifndef _U_
#define _U_ __attribute__((unused))
#endif

#define PACKAGE "libsmb2"
#define PACKAGE_NAME "libsmb2"
#define PACKAGE_VERSION "6.2-ps5upload"
#define VERSION "6.2-ps5upload"

#endif
