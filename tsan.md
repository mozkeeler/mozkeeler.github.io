I'm working on some Firefox patches involving threading, locks, etc. (to wit, hyper-dimensional foot-guns), and I was
asked to run some changes through TSan ([Thread Sanitizer](https://clang.llvm.org/docs/ThreadSanitizer.html)) by a
reviewer. There is an [MDN page on TSan](https://developer.mozilla.org/en-US/docs/Mozilla/Projects/Thread_Sanitizer),
and it's a good starting place, but it certainly didn't get me all of the way. Now having spent a fair bit of time
working it out, I figured I would write up my collection of tweaks for posterity. (I decided against directly editing
the MDN page as my setup may be different from others, and there's no guarantee that what worked for me will translate
anywhere else. In essence, your mileage may vary. I'm running clang 3.9.1 on Fedora 25 as of June 2017.)

First, the mozconfig. Here's what I ended up with:

```
ac_add_options --enable-optimize="-O2 -gline-tables-only"
ac_add_options --disable-debug
ac_add_options --disable-crashreporter
ac_add_options --enable-thread-sanitizer
ac_add_options --disable-jemalloc
ac_add_options --disable-elf-hack
export CFLAGS="-fsanitize=thread"
export CXXFLAGS="-fsanitize=thread"
export LDFLAGS="-fsanitize=thread"
export MOZ_DEBUG_SYMBOLS=1
ac_add_options --enable-debug-symbols
ac_add_options --disable-install-strip
export CC=clang
export CXX=clang++
```

The main difference (other than not manually setting the now-autodetected values for MOZ\_OBJDIR and MOZ\_MAKE\_FLAGS),
is that I found that if I specified `-fPIC -pie` in the various `*FLAGS` environment variables, any resulting binary
would print `FATAL: ThreadSanitizer: unexpected memory mapping` and exit. I believe this has something to do with that
Thread Sanitizer doesn't support non-position-independent code (as noted at the bottom of the clang docs, linked above),
and so it sets the default flags appropriatly if you *don't* specify `-fPIC`. I didn't actually investigate this too
closely after I removed the flags and got things at least running.

I'm actually getting a bit ahead of myself, though, because even with the correct mozconfig and flags, Firefox will not
compile. This is documented in [bug 1339013](https://bugzilla.mozilla.org/show_bug.cgi?id=1339013). From my reading,
TSan-specific symbols referenced in  `gfx/skia/skia/src/core/SkSharedMutex.cpp` weren't compiled correctly in the TSan
libraries on recent versions of Fedora, so the symbols can't be found. In any case, going by [comment
5](https://bugzilla.mozilla.org/show_bug.cgi?id=1339013#c5), the annotations in question can just be `#ifdef`'d out:

```
diff --git a/gfx/skia/skia/src/core/SkSharedMutex.cpp b/gfx/skia/skia/src/core/SkSharedMutex.cpp
--- a/gfx/skia/skia/src/core/SkSharedMutex.cpp
+++ b/gfx/skia/skia/src/core/SkSharedMutex.cpp
@@ -10,17 +10,17 @@
 #include "SkAtomics.h"
 #include "SkTypes.h"
 #include "SkSemaphore.h"

 #if !defined(__has_feature)
     #define __has_feature(x) 0
 #endif

-#if __has_feature(thread_sanitizer)
+#if false

     /* Report that a lock has been created at address "lock". */
     #define ANNOTATE_RWLOCK_CREATE(lock) \
         AnnotateRWLockCreate(__FILE__, __LINE__, lock)

     /* Report that the lock at address "lock" is about to be destroyed. */
     #define ANNOTATE_RWLOCK_DESTROY(lock) \
         AnnotateRWLockDestroy(__FILE__, __LINE__, lock)
```

My first successful run of Firefox after having built with TSan resulted in many, many race detections (even without my
changes). Luckily, there's already a suppression file for known, presumably-false-positives in the tree
[here](https://dxr.mozilla.org/mozilla-central/source/build/sanitizers/tsan_suppressions.txt). To use them, specify
`TSAN_OPTIONS="suppressions=/path/to/build/sanitizers/tsan_suppressions.txt"` before `./mach whatever` (or export it as
a more permanent environment variable).

Unfortunately, even after using the suppressions, I was still seeing races unrelated to my changes, such as:

```
==================
WARNING: ThreadSanitizer: data race (pid=18939)
  Read of size 8 at 0x7d040001bf20 by thread T36:
    #0 strlen <null> (xpcshell+0x0000004307af)
    #1 pthread_setname_np /usr/src/debug/glibc-2.24-33-ge9e69e4/nptl/../sysdeps/unix/sysv/linux/pthread_setname.c:38 (libpthread.so.0+0x0000000125e5)
    #2 <null> <null> (libglib-2.0.so.0+0x000000071b75)
  Previous write of size 8 at 0x7d040001bf20 by main thread (mutexes: write M11028):
    #0 malloc <null> (xpcshell+0x00000042807d)
    #1 g_malloc <null> (libglib-2.0.so.0+0x00000004f5b8)
    #2 mozilla::intl::OSPreferences::GetDateTimePattern(int, int, nsACString const&, nsAString&) mozilla-unified/intl/locale/OSPreferences.cpp:382:8 (libxul.so+0x000000bed40f)
    #3 mozilla::DateTimeFormat::FormatUDateTime(int, int, double, PRTimeParameters const*, nsAString&) mozilla-unified/intl/locale/DateTimeFormat.cpp:96:40 (libxul.so+0x000000be7d9f)
    #4 mozilla::DateTimeFormat::FormatPRTime(int, int, long, nsAString&) mozilla-unified/intl/locale/DateTimeFormat.cpp:52:10 (libxul.so+0x000000be79f2)
    #5 mozilla::psm::GetDateBoundary(nsIX509Cert*, nsString&, nsString&, bool&) mozilla-unified/security/manager/ssl/TransportSecurityInfo.cpp:777:3 (libxul.so+0x000005e2f46e)
    #6 mozilla::psm::AppendErrorTextTime(nsIX509Cert*, nsINSSComponent*, nsString&) mozilla-unified/security/manager/ssl/TransportSecurityInfo.cpp:790 (libxul.so+0x000005e2f46e)

...

    #32 JS::Evaluate(JSContext*, JS::ReadOnlyCompileOptions const&, char const*, unsigned long, JS::MutableHandle<JS::Value>) mozilla-unified/js/src/jsapi.cpp:4702:15 (libxul.so+0x0000068d55c9)
    #33 ProcessArgs(mozilla::dom::AutoJSAPI&, char**, int, XPCShellDirProvider*) mozilla-unified/js/xpconnect/src/XPCShellImpl.cpp:1129:13 (libxul.so+0x000001b55271)
    #34 XRE_XPCShellMain(int, char**, char**, XREShellData const*) mozilla-unified/js/xpconnect/src/XPCShellImpl.cpp:1522 (libxul.so+0x000001b55271)
    #35 mozilla::BootstrapImpl::XRE_XPCShellMain(int, char**, char**, XREShellData const*) mozilla-unified/toolkit/xre/Bootstrap.cpp:53:12 (libxul.so+0x00000619a22e)
    #36 main mozilla-unified/js/xpconnect/shell/xpcshell.cpp:68:29 (xpcshell+0x0000004b6945)
  Location is heap block of size 13 at 0x7d040001bf20 allocated by main thread:
    #0 malloc <null> (xpcshell+0x00000042807d)
    #1 g_malloc <null> (libglib-2.0.so.0+0x00000004f5b8)
    #2 mozilla::intl::OSPreferences::GetDateTimePattern(int, int, nsACString const&, nsAString&) mozilla-unified/intl/locale/OSPreferences.cpp:382:8 (libxul.so+0x000000bed40f)
    #3 mozilla::DateTimeFormat::FormatUDateTime(int, int, double, PRTimeParameters const*, nsAString&) mozilla-unified/intl/locale/DateTimeFormat.cpp:96:40 (libxul.so+0x000000be7d9f)
    #4 mozilla::DateTimeFormat::FormatPRTime(int, int, long, nsAString&) mozilla-unified/intl/locale/DateTimeFormat.cpp:52:10 (libxul.so+0x000000be79f2)
    #5 mozilla::psm::GetDateBoundary(nsIX509Cert*, nsString&, nsString&, bool&) mozilla-unified/security/manager/ssl/TransportSecurityInfo.cpp:777:3 (libxul.so+0x000005e2f46e)
    #6 mozilla::psm::AppendErrorTextTime(nsIX509Cert*, nsINSSComponent*, nsString&) mozilla-unified/security/manager/ssl/TransportSecurityInfo.cpp:790 (libxul.so+0x000005e2f46e)

...

    #32 JS::Evaluate(JSContext*, JS::ReadOnlyCompileOptions const&, char const*, unsigned long, JS::MutableHandle<JS::Value>) mozilla-unified/js/src/jsapi.cpp:4702:15 (libxul.so+0x0000068d55c9)
    #33 ProcessArgs(mozilla::dom::AutoJSAPI&, char**, int, XPCShellDirProvider*) mozilla-unified/js/xpconnect/src/XPCShellImpl.cpp:1129:13 (libxul.so+0x000001b55271)
    #34 XRE_XPCShellMain(int, char**, char**, XREShellData const*) mozilla-unified/js/xpconnect/src/XPCShellImpl.cpp:1522 (libxul.so+0x000001b55271)
    #35 mozilla::BootstrapImpl::XRE_XPCShellMain(int, char**, char**, XREShellData const*) mozilla-unified/toolkit/xre/Bootstrap.cpp:53:12 (libxul.so+0x00000619a22e)
    #36 main mozilla-unified/js/xpconnect/shell/xpcshell.cpp:68:29 (xpcshell+0x0000004b6945)
  Mutex M11028 (0x7d4800083d58) created at:
    #0 pthread_mutex_init <null> (xpcshell+0x000000429bfa)
    #1 mozilla::detail::MutexImpl::MutexImpl() mozilla-unified/mozglue/misc/Mutex_posix.cpp:56:3 (xpcshell+0x0000004b74a9)
    #2 mozilla::OffTheBooksMutex::OffTheBooksMutex(char const*) mozilla-unified/obj-x86_64-pc-linux-gnu/dist/include/mozilla/Mutex.h:46:7 (libxul.so+0x000005e2d3fd)
    #3 mozilla::Mutex::Mutex(char const*) mozilla-unified/obj-x86_64-pc-linux-gnu/dist/include/mozilla/Mutex.h:123 (libxul.so+0x000005e2d3fd)
    #4 mozilla::psm::TransportSecurityInfo::TransportSecurityInfo() mozilla-unified/security/manager/ssl/TransportSecurityInfo.cpp:41 (libxul.so+0x000005e2d3fd)

...

    #22 MessageLoop::Run() mozilla-unified/ipc/chromium/src/base/message_loop.cc:211 (libxul.so+0x000001339ddc)
    #23 nsThread::ThreadFunc(void*) mozilla-unified/xpcom/threads/nsThread.cpp:503:11 (libxul.so+0x000000b9aa6f)
    #24 _pt_root mozilla-unified/nsprpub/pr/src/pthreads/ptthread.c:216:5 (libnspr4.so+0x000000041628)
  Thread T36 'dconf worker' (tid=18978, running) created by main thread at:
    #0 pthread_create <null> (xpcshell+0x000000429736)
    #1 <null> <null> (libglib-2.0.so.0+0x00000008f65f)
    #2 mozilla::intl::OSPreferences::GetDateTimePattern(int, int, nsACString const&, nsAString&) mozilla-unified/intl/locale/OSPreferences.cpp:382:8 (libxul.so+0x000000bed40f)
    #3 mozilla::DateTimeFormat::FormatUDateTime(int, int, double, PRTimeParameters const*, nsAString&) mozilla-unified/intl/locale/DateTimeFormat.cpp:96:40 (libxul.so+0x000000be7d9f)
    #4 mozilla::DateTimeFormat::FormatPRTime(int, int, long, nsAString&) mozilla-unified/intl/locale/DateTimeFormat.cpp:52:10 (libxul.so+0x000000be79f2)
    #5 mozilla::psm::GetDateBoundary(nsIX509Cert*, nsString&, nsString&, bool&) mozilla-unified/security/manager/ssl/TransportSecurityInfo.cpp:777:3 (libxul.so+0x000005e2f46e)
    #6 mozilla::psm::AppendErrorTextTime(nsIX509Cert*, nsINSSComponent*, nsString&) mozilla-unified/security/manager/ssl/TransportSecurityInfo.cpp:790 (libxul.so+0x000005e2f46e)

...

    #32 JS::Evaluate(JSContext*, JS::ReadOnlyCompileOptions const&, char const*, unsigned long, JS::MutableHandle<JS::Value>) mozilla-unified/js/src/jsapi.cpp:4702:15 (libxul.so+0x0000068d55c9)
    #33 ProcessArgs(mozilla::dom::AutoJSAPI&, char**, int, XPCShellDirProvider*) mozilla-unified/js/xpconnect/src/XPCShellImpl.cpp:1129:13 (libxul.so+0x000001b55271)
    #34 XRE_XPCShellMain(int, char**, char**, XREShellData const*) mozilla-unified/js/xpconnect/src/XPCShellImpl.cpp:1522 (libxul.so+0x000001b55271)
    #35 mozilla::BootstrapImpl::XRE_XPCShellMain(int, char**, char**, XREShellData const*) mozilla-unified/toolkit/xre/Bootstrap.cpp:53:12 (libxul.so+0x00000619a22e)
    #36 main mozilla-unified/js/xpconnect/shell/xpcshell.cpp:68:29 (xpcshell+0x0000004b6945)
SUMMARY: ThreadSanitizer: data race (mozilla-unified/obj-x86_64-pc-linux-gnu/dist/bin/xpcshell+0x4307af) in strlen
==================
```

I don't really know what's going on here, but I think the 'dconf worker' thread (which is part of gnome?) is calling
some 3rd-party library functions that Firefox is also calling without any kind of synchronization. Apparently there's
some global state, so these are probably actual data races. In any case, these weren't related to what I was working on,
so I needed to suppress them somehow. I ended up copying and adding the following to the existing
`tsan_suppressions.txt`:

```
race:libgobject
race:libglib
race:libgio
```

And there you have it, unless I forgot something.
