# Bildvisare Code Review

Comprehensive review of the entire Bildvisare application.

## 🔴 CRITICAL - Security Issues

### Electron Security (main.js:350-352, 386-387)
- [ ] **CRITICAL**: `nodeIntegration: true` + `contextIsolation: false` is a severe security risk
  - Allows renderer process to execute arbitrary Node.js code
  - If image paths or any user input reaches renderer, potential RCE
  - **Fix**: Use contextBridge and preload script, disable nodeIntegration
  - **Impact**: Complete security overhaul required

### Command Injection Risk (main.js:244-248)
- [ ] **HIGH**: `execSync` with regex-escaped user input in `isProcessAlive()`
  - Regex escaping may not cover all edge cases
  - Better: Use `ps` output parsing or process management module
  - **Fix**: Use safer process detection method

### Input Validation
- [ ] **MEDIUM**: No validation of `bildPath` from URL parameters
  - Could potentially load arbitrary files
  - **Fix**: Validate file paths, restrict to safe directories

### Hardcoded Paths
- [ ] **LOW**: Python interpreter path hardcoded (main.js:41)
  - Already noted, but creates deployment issues
  - **Fix**: Make configurable or use env variable

## 🟡 MEDIUM - Bugs & Issues

### Swedish Text Remaining
- [ ] **index.html:7**: "Ingen bild vald" → English
- [ ] **main.js:166**: "Skapar nytt fönster" → English
- [ ] **main.js:169**: "laddar om fönster med bild" → English
- [ ] **renderer.js:39**: Comment "Skapa overlay-element i DOM" → English

### Variable Redeclaration (renderer.js)
- [ ] **Line 28-29 and 185-186**: `lastMouseClientX`, `lastMouseClientY` declared twice
  - Second declaration shadows first
  - **Fix**: Remove duplicate declarations

### Missing Error Handling
- [ ] **main.js - writeStatus()**: No try/catch around fs.writeFileSync (line 138)
  - Could crash app if disk full or permissions issue
  - **Fix**: Add try/catch with error logging
- [ ] **main.js - convertNEFtoJPG**: Doesn't handle script not found
- [ ] **main.js - launchSlaveViewer**: spawn() errors not handled
- [ ] **renderer.js - reloadIfChanged**: fs.stat errors silently ignored

### Race Conditions
- [ ] **main.js - waitForJPGReady**: Only checks file size (>50KB)
  - Doesn't validate JPEG header or completeness
  - **Fix**: Validate file is complete before opening

### Magic Numbers
- [ ] Extract constants: 50*1024 (min JPG size), 1500 (poll interval), 1000 (reload interval)
- [ ] Document zoom factors: 1.07, 10 (max), 0.1 (min)
- [ ] Document retry counts: 20 retries, 100ms delay

## 🟢 LOW - Code Quality

### Documentation
- [ ] No JSDoc comments for functions
- [ ] No inline documentation for complex logic
- [ ] No API documentation for IPC messages
- [ ] **Fix**: Add JSDoc for all public functions

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
- [ ] Custom `dlog()` function instead of proper logger
- [ ] Inconsistent DEBUG flags (main: false, renderer: true)
- [ ] **Fix**: Use electron-log or similar framework

## ⚡ Performance Issues

### Polling vs. Watching
- [ ] **renderer.js:345**: Polls file every 1 second with fs.stat
  - **Fix**: Use fs.watch() or chokidar
- [ ] **main.js:283,298**: Polls status file every 1.5 seconds
  - **Fix**: Use fs.watch() for file changes

### Event Handler Optimization
- [ ] **renderer.js:222**: Scroll event not debounced
  - Fires sync IPC on every scroll pixel
  - **Fix**: Debounce with requestAnimationFrame or 16ms delay
- [ ] **renderer.js:226**: Resize event not debounced
  - **Fix**: Debounce resize handler

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
- [ ] **index.html**: All styles inline
  - **Fix**: Create styles.css file
- [ ] **renderer.js**: Inline styles for overlays
  - **Fix**: Use CSS classes

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
- [ ] **Critical**: Renderer has direct fs access (security + architecture issue)
  - Violates Electron best practices
  - **Fix**: All fs operations should go through IPC to main process

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

### Priority 1 - Security (Do First!)
1. Fix Electron security (contextBridge, preload script)
2. Fix command injection in isProcessAlive
3. Add input validation

### Priority 2 - Critical Bugs
1. Fix variable redeclaration in renderer
2. Add error handling to fs operations
3. Fix Swedish text in code
4. Extract magic numbers to constants

### Priority 3 - Performance
1. Replace polling with fs.watch
2. Debounce scroll/resize events
3. Use async fs operations

### Priority 4 - Code Quality
1. Add JSDoc documentation
2. Extract modules/refactor
3. Implement proper logging
4. Add CSS file

### Priority 5 - Architecture
1. Remove nodeIntegration from renderer
2. Move all fs operations to main process via IPC
3. Consider better multi-window architecture

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
