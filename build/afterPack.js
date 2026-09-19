/**
 * electron-builder afterPack hook.
 *
 * Strips macOS extended attributes (xattrs) and quarantine flags from the
 * packaged .app bundle BEFORE codesign runs. Sync clients (OneDrive, iCloud
 * Drive) attach metadata (com.apple.metadata:*, com.apple.lastuseddate#PS,
 * etc.) that gets copied into the packaged bundle and trips codesign with:
 *
 *   "resource fork, Finder information, or similar detritus not allowed"
 *
 * Same hook WESC uses, minus its NDI-specific steps.
 *
 * Best-effort: if xattr is unavailable (non-mac runner) or fails on any
 * file, we log and carry on. We do NOT abort the build.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PROBLEMATIC_XATTRS = [
  'com.apple.FinderInfo',
  'com.apple.ResourceFork',
  'com.apple.quarantine',
  'com.apple.provenance',
  'com.apple.macl',
  'com.apple.metadata:kMDItemWhereFroms',
  'com.apple.lastuseddate#PS'
];

const run = (cmd, args, { quiet = false } = {}) => {
  try {
    execFileSync(cmd, args, { stdio: quiet ? 'ignore' : 'inherit' });
    return true;
  } catch (err) {
    if (!quiet) {
      console.warn(`[afterPack] ${cmd} ${args.join(' ')} failed (continuing): ${err.message}`);
    }
    return false;
  }
};

const clearMacMetadata = (root) => {
  if (!root || !fs.existsSync(root)) return;

  run('find', [root, '-name', '.DS_Store', '-delete']);
  run('find', [root, '-name', '._*', '-delete']);
  run('dot_clean', ['-m', root], { quiet: true });
  run('xattr', ['-cr', root], { quiet: true });
  run('find', [root, '-exec', 'xattr', '-c', '{}', '+'], { quiet: true });

  for (const attr of PROBLEMATIC_XATTRS) {
    run('find', [root, '-exec', 'xattr', '-d', attr, '{}', '+'], { quiet: true });
    run('xattr', ['-d', attr, root], { quiet: true });
  }

  run('xattr', ['-cr', root], { quiet: true });
};

const listAppExecutables = (root) => {
  const found = [];
  const stack = [root];

  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;
      if (!fullPath.includes(`${path.sep}Contents${path.sep}MacOS${path.sep}`)) continue;

      try {
        const stat = fs.statSync(fullPath);
        if ((stat.mode & 0o111) !== 0) found.push(fullPath);
      } catch {
        // Ignore files that disappear while walking a generated bundle.
      }
    }
  }

  return found;
};

const stripExecutableResourceForks = (root) => {
  if (!root || !fs.existsSync(root)) return 0;

  let cleaned = 0;
  for (const file of listAppExecutables(root)) {
    let tmp = '';

    try {
      const stat = fs.statSync(file);
      tmp = path.join(
        os.tmpdir(),
        `ytgrab-clean-${process.pid}-${Date.now()}-${path.basename(file).replace(/[^a-z0-9._-]/gi, '_')}`
      );

      // Rewriting the data fork ourselves is more reliable than xattr/ditto
      // for com.apple.provenance, which macOS may refuse to delete in-place.
      fs.writeFileSync(tmp, fs.readFileSync(file), { mode: stat.mode });
      fs.chmodSync(tmp, stat.mode);
      fs.utimesSync(tmp, stat.atime, stat.mtime);
      run('xattr', ['-c', tmp], { quiet: true });
      fs.renameSync(tmp, file);
      fs.chmodSync(file, stat.mode);
      fs.utimesSync(file, stat.atime, stat.mtime);
      run('xattr', ['-c', file], { quiet: true });
      cleaned += 1;
    } catch (err) {
      try {
        if (tmp) fs.rmSync(tmp, { force: true });
      } catch {
        // Best effort cleanup only.
      }
      console.warn(`[afterPack] executable metadata cleanup skipped ${file}: ${err.message}`);
    }
  }

  return cleaned;
};

module.exports = async function afterPack(context) {
  // Only relevant on macOS — xattr/codesign don't apply to win/linux.
  if (context.electronPlatformName !== 'darwin') return;

  const appOutDir = context.appOutDir;
  if (!appOutDir || !fs.existsSync(appOutDir)) return;

  try {
    // Finder and iCloud can leave both xattrs and AppleDouble files in
    // nested .app bundles. Codesign treats either as "detritus", so run
    // every native cleanup macOS gives us before signing starts.
    clearMacMetadata(appOutDir);
    const cleanedExecutables = stripExecutableResourceForks(appOutDir);
    clearMacMetadata(appOutDir);
    if (fs.existsSync('/usr/bin/SetFile')) {
      run('/usr/bin/SetFile', ['-c', '', '-t', '', appOutDir]);
      run('find', [appOutDir, '-type', 'f', '-exec', '/usr/bin/SetFile', '-c', '', '-t', '', '{}', '+']);
    }
    console.log(
      `[afterPack] macOS metadata cleanup ${appOutDir} ✓ (${cleanedExecutables} executable forks stripped)`
    );
  } catch (err) {
    // Don't fail the build — codesign will tell us if there's still a problem.
    console.warn(`[afterPack] metadata cleanup failed (continuing): ${err.message}`);
  }
};
