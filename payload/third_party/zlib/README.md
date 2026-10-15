zlib 1.3.1, the inflate side only, unmodified: `adler32.c`, `crc32.c`, `crc32.h`,
`inffast.c`, `inffast.h`, `inffixed.h`, `inflate.c`, `inflate.h`, `inftrees.c`,
`inftrees.h`, `zutil.c`, `zutil.h`, `gzguts.h` (included by zutil.c), `zlib.h`, `zconf.h`, `LICENSE`
from https://github.com/madler/zlib/releases/download/v1.3.1/zlib-1.3.1.tar.gz
(SHA-256 9a93b2b7dfdac77ceba5a558a580e74667dd6fede4585b91eefb60f03b72df23).
The helper inflates a `.ffpfsc` container's blocks with it to decompress a game image on
the console (#453; payload/src/ffpfsc_unpack.c).
