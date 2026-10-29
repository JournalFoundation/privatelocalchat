# Deployment and recovery

## GitHub Actions

`.github/workflows/deploy.yml` validates and builds the exact pushed commit before uploading `dist/` with pinned Wrangler. `main` targets Pages project `privatelocalchat`; `dev` targets the separate project `privatelocalchat-dev`. Each project has only its own custom domain. Manual deployment uses **Actions → Deploy Cloudflare Pages → Run workflow**, selecting `main` or `dev`.

Deployment jobs serialize independently by branch. Immediately before upload the job compares the checkout SHA to the current branch tip and skips superseded commits. Failed validation prevents uploading. The workflow summary links to the deployed site; the build artifact is retained with its commit identifier. Release tagging/changelog work follows a successful production deployment; its changelog commit goes through the same deployment checks.

Repository Actions secrets are `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The operator's local provisioning token is at `/root/.config/privatelocalchat/cloudflare-api-token`, outside Git. Never copy it into application code, commands, logs, or build output.

## Models

The R2 bucket is `privatelocalchat-assets`, exposed at `assets.privatelocal.chat`. See `ops/cloudflare/CDN-OPERATIONS.txt` and the tracked provisioning/publication scripts. Models are immutable, versioned objects. Upload new versions at new keys, verify every size and SHA-256, then update the application catalogue. Keep older versions available for older deployed apps.

Model files use one-year immutable caching; the discovery catalogue uses a one-hour TTL. Standard edge caching has a 512 MB object ceiling. The current largest model shard is 508,559,360 bytes. Public CORS supports GET, HEAD, and byte ranges. The model downloader owns persistent model storage; the service worker caches the app/runtime shell and never deletes model caches.

## Rollback

In Cloudflare **Workers & Pages**, select the affected project, open **Deployments**, choose the last verified production deployment and select **Rollback to this deployment**. Production and development roll back independently. A later push will deploy again, so revert the faulty source commit on the affected branch before resuming normal releases.

For a source-controlled rollback, use `git revert` on the faulty commit and push the same branch. Confirm the resulting Actions job succeeds and `/version.json` identifies the revert commit. Model URLs remain available across rollbacks. Browser data keys are unchanged; do not clear site storage to roll back.

Check both app domains, canonical redirects, version identity, offline app installation, model installation/load, local generation, and feedback links after a release. A successful upload alone does not prove model inference works.
