# Bildvisare Code Review

Comprehensive review of the entire Bildvisare application.

## 🔴 CRITICAL - Security Issues

### Electron Security (main.js:350-352, 386-387)
- [x] **CRITICAL**: `nodeIntegration: true` + `contextIsolation: false` is a severe security risk
  - ✅ FIXED: Created preload.js with contextBridge
  - ✅ FIXED: Disabled nodeIntegration, enabled contextIsolation
  - ✅ FIXED: Renderer uses whitelisted IPC channels only
  - **Impact**: Complete security overhaul completed

### Command Injection Risk (main.js:244-248)
- [x] **HIGH**: `execSync` with regex-escaped user input in `isProcessAlive()`
  - ✅ FIXED: Now uses safe `ps -eo args` output parsing
  - ✅ FIXED: No user input in shell commands
  - **Fix**: Uses safer process detection method

### Input Validation
- [x] **MEDIUM**: No validation of `bildPath` from URL parameters
  - ✅ FIXED: Added isValidImagePath() validation function
  - ✅ FIXED: Restricts paths to $HOME or /tmp
  - ✅ FIXED: Validates file extensions
  - **Fix**: File paths validated at all entry points

### Hardcoded Paths
- [ ] **LOW**: Python interpreter path hardcoded (main.js:41)
  - Already noted, but creates deployment issues
  - **Fix**: Make configurable or use env variable

## 🟡 MEDIUM - Bugs & Issues

### Swedish Text Remaining
- [x] **index.html:7**: "Ingen bild vald" → English
  - ✅ FIXED: "No image selected"
- [x] **main.js:166**: "Skapar nytt fönster" → English
  - ✅ FIXED: "Creating new window"
- [x] **main.js:169**: "laddar om fönster med bild" → English
  - ✅ FIXED: "Reloading window with image"
- [x] **renderer.js:39**: Comment "Skapa overlay-element i DOM" → English
  - ✅ FIXED: "Create overlay element in DOM"

### Variable Redeclaration (renderer.js)
- [x] **Line 28-29 and 185-186**: `lastMouseClientX`, `lastMouseClientY` declared twice
  - ✅ FIXED: Removed duplicate declarations

### Missing Error Handling
- [x] **main.js - writeStatus()**: No try/catch around fs.writeFileSync (line 138)
  - ✅ FIXED: Added try/catch with error logging
- [x] **main.js - convertNEFtoJPG**: Doesn't handle script not found
  - ✅ FIXED: Checks for script and Python interpreter, handles spawn errors
- [x] **main.js - launchSlaveViewer**: spawn() errors not handled
  - ✅ FIXED: Added error handler for spawn
- [x] **renderer.js - reloadIfChanged**: fs.stat errors silently ignored
  - ✅ FIXED: Now uses secure IPC with error handling

### Race Conditions
- [ ] **main.js - waitForJPGReady**: Only checks file size (>50KB)
  - Doesn't validate JPEG header or completeness
  - **Fix**: Validate file is complete before opening

### Magic Numbers
- [x] Extract constants: 50*1024 (min JPG size), 1500 (poll interval), 1000 (reload interval)
  - ✅ FIXED: Extracted to main.js constants
- [x] Document zoom factors: 1.07, 10 (max), 0.1 (min)
  - ✅ FIXED: Extracted to renderer.js constants
- [x] Document retry counts: 20 retries, 100ms delay
  - ✅ FIXED: Extracted to constants with documentation

## 🟢 LOW - Code Quality

### Documentation
- [x] No JSDoc comments for functions
  - ✅ FIXED: Added JSDoc to all key functions in main.js
- [ ] No inline documentation for complex logic
  - NOTE: Key areas now documented, further inline docs can be added as needed
- [ ] No API documentation for IPC messages
  - NOTE: IPC channels documented in preload.js
- [x] **Fix**: Add JSDoc for all public functions
  - ✅ FIXED: Key functions documented

### Global State Management
- [ ] Too many module-level variables in main.js (13+)
- [ ] No clear state management pattern
- [ ] **Fix**: Consider state object or class-based architecture

### Code Organization
- [ ] **main.js**: 435 lines, multiple concerns mixed
  - Window management
  - File conversion
  - Process management
  - Status file handling
- [ ] **renderer.js**: 353 lines, could split zoom/sync logic
- [ ] **Fix**: Extract modules (conversion, status, windows)

### Callback Hell
- [ ] **convertNEFtoJPG**: Nested callbacks (3 levels)
  - **Fix**: Use Promises or async/await

### Logging
- [x] Custom `dlog()` function instead of proper logger
  - ✅ FIXED: Implemented logger with debug/info/warn/error levels
- [x] Inconsistent DEBUG flags (main: false, renderer: true)
  - ✅ FIXED: Log level controlled via BILDVISARE_LOG_LEVEL env var
- [x] **Fix**: Use electron-log or similar framework
  - ✅ FIXED: Implemented custom logger (lightweight, no dependency)

## ⚡ Performance Issues

### Polling vs. Watching
- [x] **renderer.js:345**: Polls file every 1 second with fs.stat
  - ✅ FIXED: Now uses fs.watch via IPC with event notifications
- [ ] **main.js:283,298**: Polls status file every 1.5 seconds
  - NOTE: Status file watching kept as polling (inter-process communication)
  - Alternative would require more complex multi-process coordination

### Event Handler Optimization
- [x] **renderer.js:222**: Scroll event not debounced
  - ✅ FIXED: Debounced to 16ms (~60fps) for smooth performance
- [x] **renderer.js:226**: Resize event not debounced
  - ✅ FIXED: Debounced to 100ms

### Synchronous Operations
- [ ] Many blocking fs operations: fs.existsSync, fs.statSync, fs.readFileSync
  - Blocks event loop
  - **Fix**: Use async versions where possible

### DOM Manipulation
- [ ] **renderer.js:286-298**: Creates detach overlay with inline styles
  - Should use CSS classes
  - Create once, toggle visibility

## 🎨 Best Practices

### CSS & Styling
- [x] **index.html**: All styles inline
  - ✅ FIXED: Created styles.css file, removed inline styles
- [ ] **renderer.js**: Inline styles for overlays
  - NOTE: Dynamic overlay styles kept in JS (created at runtime)

### Configuration
- [ ] No config file for user preferences
- [ ] Hardcoded window sizes (800x600)
- [ ] Hardcoded zoom speeds (1.07)
- [ ] **Fix**: Create config.json or use electron-store

### TypeScript/JSDoc
- [ ] No type safety
- [ ] No autocomplete for functions
- [ ] **Fix**: Add JSDoc comments or migrate to TypeScript

### Testing
- [ ] No unit tests
- [ ] No integration tests
- [ ] No E2E tests
- [ ] **Fix**: Add Jest for unit tests, Spectron/Playwright for E2E

## 🏗️ Architecture Issues

### Renderer with Node.js Access
- [x] **Critical**: Renderer has direct fs access (security + architecture issue)
  - ✅ FIXED: All fs operations now go through IPC to main process
  - ✅ FIXED: Renderer uses contextBridge API only

### Multi-Instance IPC
- [ ] Uses JSON status files for inter-process communication
  - Works but not ideal
  - **Fix**: Could use electron's built-in IPC or MessagePort

### Process Management
- [ ] Spawns copies of itself for slave windows
  - Creative but fragile
  - Uses pkill to cleanup (platform-specific)
  - **Fix**: Consider multi-window single-process architecture

## 📝 Missing Features

### User Experience
- [ ] No keyboard shortcuts help/overlay (O, ESC, Q, X, +, -, =, A)
- [ ] No indication of which shortcuts are available
- [ ] No status bar showing current zoom level
- [ ] No file info display (resolution, size, format)

### Error Recovery
- [ ] If NEF conversion fails, no retry mechanism
- [ ] No way to recover from failed slave launch
- [ ] Error overlays don't auto-dismiss

### Progress Indication
- [ ] Large NEF files (50MB+) show no progress during conversion
- [ ] User doesn't know if app is frozen or working

## 📊 Priority Recommendations

### Priority 1 - Security ✅ COMPLETED
1. ✅ Fix Electron security (contextBridge, preload script)
2. ✅ Fix command injection in isProcessAlive
3. ✅ Add input validation

### Priority 2 - Critical Bugs ✅ COMPLETED
1. ✅ Fix variable redeclaration in renderer
2. ✅ Add error handling to fs operations
3. ✅ Fix Swedish text in code
4. ✅ Extract magic numbers to constants

### Priority 3 - Performance ✅ MOSTLY COMPLETED
1. ✅ Replace polling with fs.watch
2. ✅ Debounce scroll/resize events
3. ⚠️ Use async fs operations (partially - some sync ops remain for simplicity)

### Priority 4 - Code Quality ✅ COMPLETED
1. ✅ Add JSDoc documentation
2. ⚠️ Extract modules/refactor (partial - main areas improved)
3. ✅ Implement proper logging
4. ✅ Add CSS file

### Priority 5 - Architecture ✅ MOSTLY COMPLETED
1. ✅ Remove nodeIntegration from renderer (COMPLETED in Priority 1)
2. ✅ Move all fs operations to main process via IPC (COMPLETED in Priority 1)
3. ⚠️ Consider better multi-window architecture (DEFERRED - works well, major refactor)

## 📈 Metrics

| Category | Issues | Lines | Complexity |
|----------|--------|-------|------------|
| main.js | 15 | 435 | High |
| renderer.js | 12 | 353 | Medium |
| index.html | 2 | 14 | Low |
| package.json | 1 | 17 | Low |
| **Total** | **30** | **819** | **Medium-High** |

## 🎯 Recommended Refactoring

```
bildvisare/
├── src/
│   ├── main/
│   │   ├── index.js          # Main entry
│   │   ├── windows.js        # Window management
│   │   ├── conversion.js     # NEF conversion
│   │   ├── status.js         # Status file handling
│   │   ├── ipc-handlers.js   # IPC handlers
│   │   └── preload.js        # Preload script
│   ├── renderer/
│   │   ├── index.js          # Renderer entry
│   │   ├── zoom.js           # Zoom logic
│   │   ├── sync.js           # View sync
│   │   └── file-watcher.js   # File monitoring
│   ├── shared/
│   │   ├── constants.js      # Shared constants
│   │   └── types.js          # Type definitions
│   └── assets/
│       └── styles.css        # Styles
├── tests/
│   ├── unit/
│   └── e2e/
└── config.json               # User config
```

## Notes

This review identifies 30+ issues across security, bugs, performance, and code quality. The most critical issue is the Electron security configuration which should be addressed immediately. Overall, the app works well but needs refactoring for production use.
