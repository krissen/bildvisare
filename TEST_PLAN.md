# Testing Plan for Security Fixes

## ✅ Automated Tests (Already Done)

### Syntax Validation
- ✅ All JavaScript files: Valid syntax
- ✅ Module imports: Correct
- ✅ Module exports: Working

### Module Loading
- ✅ lib/conversion.js: Loads successfully
- ✅ Exports: convertNEFtoJPG, ensureJPGAndLaunchSlave, setPythonPath
- ✅ main.js: Imports conversion module correctly

## ⚠️ Manual Tests Required

### Critical Path Testing

#### 1. Basic Startup
```bash
# From dev branch, test current working version first
git checkout dev
npm start  # or: npx electron .

# Then test the security fixes
git checkout feature/security-fixes
npm start
```

**Expected:** App should start without errors

#### 2. Open Image File
- Open a JPG/PNG file from Finder (right-click → Open With → Bildvisare)
- **Expected:** Image displays correctly
- **Expected:** No console errors about fs access or IPC

#### 3. Keyboard Controls
Test all keyboard shortcuts:
- `+` / `-` : Zoom in/out
- `=` : Reset zoom to 1:1
- `A` : Auto-fit mode
- `Q` : Quit window
- `ESC` : Close slave windows + current window

**Expected:** All controls work as before

#### 4. NEF Conversion (CRITICAL - Security Changes)
This is the most important test since we changed security model:

1. Open a NEF file from `~/Pictures/nerladdat/`
2. Press `O` to open original (triggers conversion)
3. **Expected:**
   - Wait overlay appears
   - Conversion happens
   - Slave window opens with converted JPG
   - No security errors in console

#### 5. File Monitoring (Performance Changes)
1. Open an image file
2. Edit the file externally (e.g., in Preview, make a small change)
3. Save the file
4. **Expected:**
   - Image reloads automatically (within ~1 second)
   - No polling errors in console

#### 6. Dual Window Sync
1. Open an image
2. Press `O` (if NEF) or open second window manually
3. Zoom/pan in master window
4. **Expected:**
   - Slave window follows (synced zoom/pan)
   - No excessive IPC messages in console

#### 7. Detachment Mode
1. With both windows open
2. In slave window, press `X`
3. Zoom/pan in master
4. **Expected:**
   - Slave shows "Detached from master"
   - Slave does NOT follow master movements
   - Press `X` again to re-sync

### Debug Mode Testing

Run with debug logging:
```bash
BILDVISARE_LOG_LEVEL=debug npx electron .
```

**Check for:**
- ✅ No security warnings
- ✅ No uncaught errors
- ✅ File watching notifications (when files change)
- ✅ IPC calls are debounced (not excessive on scroll)

## 🔍 Specific Security Validations

### 1. Renderer Isolation
**Open DevTools** (may need to enable in code): View → Toggle Developer Tools

In Console, try:
```javascript
// These should ALL fail with errors:
require('fs')           // Should: undefined or error
require('child_process') // Should: undefined or error
process.exit()          // Should: undefined or error

// This should work:
window.bildvisareAPI    // Should: object with send, on, watchFile, etc.
```

**Expected:** Renderer has NO direct Node.js access

### 2. File Path Validation
Try opening files from restricted locations:
- `/etc/passwd` (should be rejected)
- `/System/Library/` files (should be rejected)
- Files outside $HOME or /tmp (should be rejected)

**Expected:** Security validation prevents access

## 🐛 Regression Testing

Test that nothing broke:
- [ ] Master window opens correctly
- [ ] Slave window spawns correctly
- [ ] NEF conversion works
- [ ] File monitoring works
- [ ] Zoom/pan sync works
- [ ] Keyboard shortcuts work
- [ ] App closes cleanly (no hanging processes)

## 📝 Known Limitations

- **Display Required:** Cannot test GUI without display (CLI testing limited)
- **NEF Files:** Requires actual NEF files in ~/Pictures/nerladdat/
- **Python Environment:** Requires hitta_ansikten conda env for NEF conversion

## ✅ If All Tests Pass

Merge to dev:
```bash
git checkout dev
git merge --no-ff feature/security-fixes
git branch -d feature/security-fixes
```

## ❌ If Tests Fail

1. Note the specific failure
2. Check console for error messages
3. Check if it's a new bug or existing behavior
4. Report back for fixes
