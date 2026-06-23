# create-slide-quiz-plus

Scaffold a [Reveal.js](https://revealjs.com) or [Slidev](https://sli.dev) presentation with live audience quizzes, powered by [slide-quiz](https://github.com/anycable/slide-quiz) and [AnyCable](https://anycable.io).

Fork of [`create-slide-quiz`](https://www.npmjs.com/package/create-slide-quiz) with **Cloudflare Pages** support added alongside the original Netlify and Vercel targets.

## Usage

```bash
npx create-slide-quiz-plus
```

Run this inside your existing Reveal.js or Slidev project directory.

## Deploy targets

- **Netlify** — copies templates from the installed `slide-quiz` package into `netlify/functions/`, writes `netlify.toml`
- **Vercel** — copies templates from the installed `slide-quiz` package into `api/`
- **Cloudflare Pages** — copies bundled templates into `functions/api/`, writes `wrangler.toml` with a sanitized project name, sets up `.dev.vars`

The Cloudflare templates ship inside this CLI (`templates/cloudflare/`), so it works against the upstream `slide-quiz` package on npm — no need to wait for a republished `slide-quiz`.

Cloudflare detection looks for `wrangler.toml`, `wrangler.jsonc`, `wrangler.json`, or `.wrangler/`. If the Wrangler CLI is installed, the script can create the Pages project, push the `ANYCABLE_BROADCAST_URL` secret, and deploy.

## Requirements

- Node.js 18+
- An existing Reveal.js or Slidev project (or the CLI will scaffold one)
- Optional platform CLIs for one-shot deploy: `netlify`, `vercel`, or `wrangler`

## License

MIT
