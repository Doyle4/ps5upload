/* ps5upload: a hand-written configuration for the libarchive subset in this folder (the RAR and
 * RAR5 readers and what they need), the same for the PS5 build and the host test build. No
 * external libraries: no zlib (its own CRC-32), no iconv, no crypto. Only POSIX that both the
 * PS5's FreeBSD-derived libc and macOS/Linux have. */
#ifndef PS5UPLOAD_LIBARCHIVE_CONFIG_H
#define PS5UPLOAD_LIBARCHIVE_CONFIG_H

#define HAVE_ERRNO_H 1
#define HAVE_FCNTL_H 1
#define HAVE_INTTYPES_H 1
#define HAVE_LIMITS_H 1
#define HAVE_STDARG_H 1
#define HAVE_STDINT_H 1
#define HAVE_STDLIB_H 1
#define HAVE_STRING_H 1
#define HAVE_STRINGS_H 1
#define HAVE_SYS_STAT_H 1
#define HAVE_SYS_TYPES_H 1
#define HAVE_SYS_TIME_H 1
#define HAVE_TIME_H 1
#define HAVE_UNISTD_H 1
#define HAVE_WCHAR_H 1
#define HAVE_LOCALE_H 1

#define HAVE_DECL_SIZE_MAX 1
#define HAVE_DECL_INT32_MAX 1
#define HAVE_DECL_INT32_MIN 1
#define HAVE_DECL_INT64_MAX 1
#define HAVE_DECL_INT64_MIN 1
#define HAVE_DECL_INTMAX_MAX 1
#define HAVE_DECL_INTMAX_MIN 1
#define HAVE_DECL_UINT32_MAX 1
#define HAVE_DECL_UINT64_MAX 1
#define HAVE_DECL_UINTMAX_MAX 1

#define HAVE_INTMAX_T 1
#define HAVE_UINTMAX_T 1
#define HAVE_INT16_T 1
#define HAVE_INT32_T 1
#define HAVE_INT64_T 1
#define HAVE_UINT8_T 1
#define HAVE_UINT16_T 1
#define HAVE_UINT32_T 1
#define HAVE_UINT64_T 1
#define HAVE_WCHAR_T 1

#define HAVE_ARC4RANDOM_BUF 1
#define HAVE_FCNTL 1
#define HAVE_FSTAT 1
#define HAVE_LSTAT 1
#define HAVE_MBRTOWC 1
#define HAVE_WCRTOMB 1
#define HAVE_WCSCMP 1
#define HAVE_WCSCPY 1
#define HAVE_WCSLEN 1
#define HAVE_WCTOMB 1
#define HAVE_WMEMCMP 1
#define HAVE_WMEMCPY 1
#define HAVE_WMEMMOVE 1
#define HAVE_STRERROR_R 1
#define HAVE_LOCALTIME_R 1
#define HAVE_GMTIME_R 1
#define HAVE_TIMEGM 1
#define HAVE_SETLOCALE 1

#define HAVE_EILSEQ 1
#define HAVE_SYS_STAT_H 1

/* Only the readers built here. */
#define ARCHIVE_ONLY_RAR_READERS 1

#ifndef _FILE_OFFSET_BITS
#define _FILE_OFFSET_BITS 64
#endif

#endif
