# Import Gotchas

## .js extension required on all imports

**Symptom:** `ERR_MODULE_NOT_FOUND` at runtime despite TypeScript compiling fine.

**Cause:** Project uses NodeNext module resolution. TypeScript compiles `.ts` → `.js` but does NOT rewrite import specifiers. If you write `import { foo } from './bar'`, Node looks for `./bar` (no extension) and fails.

**Fix:** Always use `.js` extension: `import { foo } from './bar.js'`

**Why not enforceable by linter?** ESLint's `import/extensions` rule doesn't understand NodeNext resolution well. This is enforced by convention.
