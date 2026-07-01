# Builds the CMS engine, copies the example site's published output into the
# sibling cawoodm.github.io/cmsfree-example repo, then commits and pushes it.
$ErrorActionPreference = 'Stop'

$repoRoot = $PSScriptRoot
$source = Join-Path $repoRoot 'example-site\publish'
$target = Join-Path $repoRoot '..\cawoodm.github.io\cmsfree-example'

if (-not (Test-Path (Join-Path $repoRoot '..\cawoodm.github.io\.git'))) {
  throw "Target repo not found — expected a cawoodm.github.io checkout at $(Join-Path $repoRoot '..\cawoodm.github.io')"
}

Write-Host "Building cms.js..."
npm run build --prefix $repoRoot
if ($LASTEXITCODE -ne 0) { throw "Build failed with exit code $LASTEXITCODE" }

New-Item -ItemType Directory -Force -Path $target | Out-Null

Write-Host "Copying $source -> $target"
robocopy $source $target /MIR /NFL /NDL /NJH /NJS
if ($LASTEXITCODE -ge 8) { throw "robocopy failed with exit code $LASTEXITCODE" }

Push-Location (Join-Path $repoRoot '..\cawoodm.github.io')
try {
  git add cmsfree-example
  $changes = git status --porcelain -- cmsfree-example
  if ([string]::IsNullOrWhiteSpace($changes)) {
    Write-Host "No changes to publish."
  } else {
    git commit -m "Update cmsfree example site"
    git push
    Write-Host "Published and pushed."
  }
} finally {
  Pop-Location
}
