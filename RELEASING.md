# Releasing

Ask the maintainer before creating a release. Releases go with substantial pushes, not every
commit.

## Checklist

1. Run the typecheck and a package dry run:

   ```bash
   npm run typecheck
   npm pack --dry-run
   ```

2. Bump the version in `package.json` (minor for features, patch for fixes) and add the same
   version to `CHANGELOG.md`.

3. Commit the bump:

   ```bash
   git add package.json CHANGELOG.md
   git commit -m "Release x.y.z"
   ```

4. Tag and push:

   ```bash
   git tag -a vx.y.z -m "oc-stats x.y.z"
   git push origin main
   git push origin vx.y.z
   ```

5. Publish to npm:

   ```bash
   npm publish
   ```

6. Create the GitHub release:

   ```bash
   gh release create vx.y.z --title "oc-stats x.y.z" --notes-file <(sed -n '/^## x.y.z/,/^## /p' CHANGELOG.md | sed '$d')
   ```

7. Verify:

   ```bash
   npm view oc-stats-tui@x.y.z version
   gh release view vx.y.z
   ```
