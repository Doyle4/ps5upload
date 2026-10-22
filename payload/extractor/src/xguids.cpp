// The interface IDs 7-Zip's COM-style interfaces are looked up by, defined once (7-Zip's own
// builds do this in their DLL export unit, which is not built here).
#include "Common/Common.h"

#include "Common/MyInitGuid.h"

#include "7zip/Archive/IArchive.h"
#include "7zip/ICoder.h"
#include "7zip/IPassword.h"
#include "7zip/IProgress.h"
#include "7zip/IStream.h"
