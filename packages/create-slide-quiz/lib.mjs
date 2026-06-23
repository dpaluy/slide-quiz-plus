/**
 * create-slide-quiz-plus — Add live audience quizzes to your presentation
 *
 * Supports Reveal.js and Slidev frameworks.
 * Deploys to Netlify, Vercel, or Cloudflare Pages.
 * Usage: cd your-presentation && npx create-slide-quiz-plus
 */

import * as p from "@clack/prompts";
import { execSync, exec } from "node:child_process";
import {
  mkdirSync, writeFileSync, readFileSync, existsSync,
  copyFileSync, readdirSync, appendFileSync,
} from "node:fs";
import { join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { platform } from "node:process";
import color from "picocolors";

const __dirname = dirname(fileURLToPath(import.meta.url));

// —— Helpers ——

function openUrl(url) {
  const cmd =
    platform === "darwin" ? "open" :
    platform === "win32" ? "start" :
    "xdg-open";
  try {
    exec(`${cmd} ${url}`);
  } catch {
    // Headless / SSH — user will see the URL in the log message
  }
}

function hasCommand(name) {
  try {
    const check = platform === "win32" ? `where ${name}` : `which ${name}`;
    execSync(check, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const CMD_TIMEOUT = 120_000; // 2 minutes for most commands
const DEPLOY_TIMEOUT = 300_000; // 5 minutes for build + deploy

function run(cmd, cwd, timeout = CMD_TIMEOUT) {
  execSync(cmd, { cwd, stdio: "inherit", timeout });
}

function sanitizeCloudflareName(input) {
  const cleaned = (input || "").toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 58);
  return cleaned || "slide-quiz";
}

// —— Detection ——

const REVEAL_CLASS_RE = /class\s*=\s*"[^"]*\breveal\b[^"]*"/;
const REVEAL_INIT_RE = /Reveal\.(initialize|configure)\(|new\s+Reveal\(/;

function findRevealHtml(dir) {
  const files = readdirSync(dir)
    .filter(f => f.endsWith(".html"))
    .sort((a, b) => (a === "index.html" ? -1 : b === "index.html" ? 1 : 0));

  for (const file of files) {
    if (REVEAL_CLASS_RE.test(readFileSync(join(dir, file), "utf-8"))) return file;
  }
  return null;
}

function findJsEntry(dir, htmlContent) {
  const match = htmlContent.match(/<script\s+type\s*=\s*"module"\s+src\s*=\s*"([^"]+)"/);
  if (match) {
    const src = match[1].replace(/^\//, "");
    if (existsSync(join(dir, src)) && REVEAL_INIT_RE.test(readFileSync(join(dir, src), "utf-8"))) {
      return src;
    }
  }

  for (const name of ["main.js", "src/main.js", "index.js", "src/index.js"]) {
    if (existsSync(join(dir, name)) && REVEAL_INIT_RE.test(readFileSync(join(dir, name), "utf-8"))) {
      return name;
    }
  }
  return null;
}

function detectFramework(dir) {
  if (existsSync(join(dir, "slides.md"))) return "slidev";
  if (findRevealHtml(dir)) return "revealjs";
  return null;
}

function detectPlatform(dir) {
  if (existsSync(join(dir, "netlify.toml")) || existsSync(join(dir, ".netlify"))) return "netlify";
  if (existsSync(join(dir, "vercel.json")) || existsSync(join(dir, ".vercel"))) return "vercel";
  if (
    existsSync(join(dir, "wrangler.toml")) ||
    existsSync(join(dir, "wrangler.jsonc")) ||
    existsSync(join(dir, "wrangler.json")) ||
    existsSync(join(dir, ".wrangler"))
  ) return "cloudflare";
  return null;
}

function detectVite(dir) {
  for (const name of ["vite.config.js", "vite.config.ts", "vite.config.mjs", "vite.config.mts"]) {
    if (existsSync(join(dir, name))) return name;
  }
  return null;
}

const PLATFORM_OPTIONS = [
  { value: "netlify", label: "Netlify", hint: "recommended" },
  { value: "vercel", label: "Vercel" },
  { value: "cloudflare", label: "Cloudflare Pages" },
];

// —— File modification ——

function insertQuizSlides(dir, htmlFile) {
  const filePath = join(dir, htmlFile);
  const content = readFileSync(filePath, "utf-8");

  if (content.includes("data-quiz-id")) return "exists";

  const slidesMatch = content.match(/class\s*=\s*"[^"]*\bslides\b[^"]*"/);
  if (!slidesMatch) return false;

  // Walk past nested <div>s to find the closing </div> of .slides
  let depth = 0;
  let i = content.indexOf(">", slidesMatch.index) + 1;
  while (i < content.length) {
    if (content.startsWith("<div", i)) depth++;
    else if (content.startsWith("</div>", i)) {
      if (depth === 0) break;
      depth--;
    }
    i++;
  }
  if (i >= content.length) return false;

  const quizHtml = `
        <!-- Live quiz — audience sees responses in real time -->
        <section data-quiz-results="q1"
                 data-quiz-question="What's your favorite color?"
                 data-quiz-options='[
                   {"label":"A","text":"Red"},
                   {"label":"B","text":"Blue"},
                   {"label":"C","text":"Green"},
                   {"label":"D","text":"Yellow"}
                 ]'>
        </section>
`;

  writeFileSync(filePath, content.slice(0, i) + quizHtml + content.slice(i));
  return true;
}

function ensureGitignore(dir, entry) {
  const gitignorePath = join(dir, ".gitignore");
  if (existsSync(gitignorePath)) {
    const content = readFileSync(gitignorePath, "utf-8");
    if (content.split("\n").some(line => line.trim() === entry)) return;
    appendFileSync(gitignorePath, `\n${entry}\n`);
  } else {
    writeFileSync(gitignorePath, `${entry}\n`);
  }
}

function modifySlidesConfig(dir, wsUrl, quizGroupId, needsEndpoints) {
  const slidesPath = join(dir, "slides.md");
  let content = readFileSync(slidesPath, "utf-8");

  const addonsYaml = "addons:\n  - slidev-addon-slide-quiz";
  const slideQuizYaml = [
    "slideQuiz:",
    `  wsUrl: ${wsUrl}`,
    `  quizGroupId: ${quizGroupId}`,
    "  quizUrl: /quiz.html",
    needsEndpoints ? "  endpoints:\n    answer: /api/quiz-answer\n    sync: /api/quiz-sync" : null,
  ].filter(Boolean).join("\n");

  if (content.startsWith("---")) {
    const closingIdx = content.indexOf("\n---", 3);
    if (closingIdx !== -1) {
      const frontmatter = content.slice(4, closingIdx);
      let additions = "";
      if (!frontmatter.includes("addons:")) additions += addonsYaml + "\n";
      if (!frontmatter.includes("slideQuiz:")) additions += slideQuizYaml + "\n";
      if (additions) {
        content = content.slice(0, closingIdx) + "\n" + additions + content.slice(closingIdx);
      }
    }
  } else {
    content = `---\n${addonsYaml}\n${slideQuizYaml}\n---\n\n${content}`;
  }

  writeFileSync(slidesPath, content);
}

const SLIDEV_QUIZ_SLIDES = `
---
# Live quiz — audience sees responses in real time
layout: quiz-results
quizId: q1
question: What's your favorite color?
options:
  - { label: A, text: Red }
  - { label: B, text: Blue }
  - { label: C, text: Green }
  - { label: D, text: Yellow }
---
`;

// —— Main ——

async function main() {
  p.intro(color.bgCyan(color.black(" create-slide-quiz-plus ")));

  const dir = process.cwd();

  // Step 1 — Detect framework

  const s = p.spinner();
  s.start("Detecting project...");

  let framework = detectFramework(dir);

  let htmlFile, htmlContent, jsEntry, viteConfig;
  let quizGroupId;
  let pkg;
  let needsInit = false;
  const pkgPath = join(dir, "package.json");
  let platform = detectPlatform(dir);

  if (framework === "revealjs") {
    htmlFile = findRevealHtml(dir);

    if (!existsSync(pkgPath)) {
      needsInit = true;
    } else {
      try {
        pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      } catch {
        s.stop(color.red("Could not parse package.json."));
        return p.cancel("Invalid package.json.");
      }
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (!deps["reveal.js"]) needsInit = true;
    }

    if (needsInit) {
      s.stop(color.green(`Found ${htmlFile}`));

      if (!existsSync(pkgPath)) {
        p.log.info("No package.json found — initializing project...");
        try {
          execSync("npm init -y", { cwd: dir, stdio: "pipe", timeout: CMD_TIMEOUT });
        } catch {
          s.stop(color.red("Could not initialize package.json."));
          return p.cancel("Run `npm init -y` manually, then re-run create-slide-quiz-plus.");
        }
      }

      p.log.info("Installing reveal.js...");
      execSync("npm install reveal.js", { cwd: dir, stdio: "pipe", timeout: CMD_TIMEOUT });
      pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      p.log.success("Project initialized with reveal.js");
    }

    htmlContent = readFileSync(join(dir, htmlFile), "utf-8");
    jsEntry = findJsEntry(dir, htmlContent);
    viteConfig = detectVite(dir);
    quizGroupId = pkg.name || basename(dir);

    if (!needsInit) s.stop(color.green("Reveal.js project detected!"));

    p.note(
      [
        `HTML file:   ${color.cyan(htmlFile)}`,
        `JS entry:    ${jsEntry ? color.cyan(jsEntry) : color.dim("not found")}`,
        `Platform:    ${platform ? color.cyan(platform) : color.dim("not detected")}`,
        `Vite:        ${viteConfig ? color.cyan(viteConfig) : color.dim("not detected")}`,
        `Quiz group:  ${color.cyan(quizGroupId)}`,
      ].join("\n"),
      "Detected project",
    );

  } else if (framework === "slidev") {
    if (existsSync(pkgPath)) {
      try {
        pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      } catch {
        s.stop(color.red("Could not parse package.json."));
        return p.cancel("Invalid package.json.");
      }
    }

    quizGroupId = pkg?.name || basename(dir);
    s.stop(color.green("Slidev project detected!"));

    if (!existsSync(pkgPath)) {
      p.log.info("No package.json found — initializing project...");
      try {
        execSync("npm init -y", { cwd: dir, stdio: "pipe", timeout: CMD_TIMEOUT });
      } catch {
        s.stop(color.red("Could not initialize package.json."));
        return p.cancel("Run `npm init -y` manually, then re-run create-slide-quiz-plus.");
      }
      pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    }

    p.note(
      [
        `Framework:   ${color.cyan("Slidev")}`,
        `Slides:      ${color.cyan("slides.md")}`,
        `Platform:    ${platform ? color.cyan(platform) : color.dim("not detected")}`,
        `Quiz group:  ${color.cyan(quizGroupId)}`,
      ].join("\n"),
      "Detected project",
    );

  } else {
    s.stop(color.yellow("Could not auto-detect framework."));

    const choice = await p.select({
      message: "What framework are you using?",
      options: [
        { value: "revealjs", label: "Reveal.js" },
        { value: "slidev", label: "Slidev" },
      ],
    });
    if (p.isCancel(choice)) return p.cancel("Cancelled.");
    framework = choice;

    if (framework === "revealjs") {
      p.log.error("Could not find a Reveal.js HTML file (with class=\"reveal\") in this directory.");
      return p.cancel("No Reveal.js HTML detected.");
    }

    // Slidev selected manually
    if (existsSync(pkgPath)) {
      try {
        pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      } catch {
        return p.cancel("Invalid package.json.");
      }
    } else {
      p.log.info("No package.json found — initializing project...");
      try {
        execSync("npm init -y", { cwd: dir, stdio: "pipe", timeout: CMD_TIMEOUT });
      } catch {
        return p.cancel("Could not initialize package.json. Run `npm init -y` manually, then re-run create-slide-quiz-plus.");
      }
      pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    }

    quizGroupId = pkg?.name || basename(dir);
  }

  // Step 2 — Platform (if not auto-detected)

  if (!platform) {
    const choice = await p.select({
      message: "Deploy platform",
      options: PLATFORM_OPTIONS,
    });
    if (p.isCancel(choice)) return p.cancel("Cancelled.");
    platform = choice;
  }

  // Step 3 — AnyCable Plus setup

  const setupAnyCable = await p.confirm({
    message: "Do you already have an AnyCable Plus app set up?",
    initialValue: false,
  });
  if (p.isCancel(setupAnyCable)) return p.cancel("Cancelled.");

  if (!setupAnyCable) {
    p.log.step(color.bold("Let's create your AnyCable Plus app"));

    openUrl("https://plus.anycable.io");
    p.log.info(`Opened ${color.underline("plus.anycable.io")} — sign in with GitHub`);

    const signedIn = await p.confirm({
      message: "Signed in? Let's continue.",
      active: "Continue",
      inactive: "Waiting...",
    });
    if (p.isCancel(signedIn)) return p.cancel("Cancelled.");

    p.note(
      [
        `1. Click ${color.bold("New Cable")}`,
        `2. Name it anything (e.g. ${color.cyan("my-cable")})`,
        `3. Under ${color.bold("Your backend")}, pick ${color.bold("JavaScript")}`,
        `4. Click ${color.bold("Next")}`,
      ].join("\n"),
      "Create a new cable",
    );

    const created = await p.confirm({
      message: "Created? Next step.",
      active: "Continue",
      inactive: "Waiting...",
    });
    if (p.isCancel(created)) return p.cancel("Cancelled.");

    p.note(
      [
        `You'll see an ${color.bold("Application secret")} screen.`,
        "",
        `→ ${color.bold("Clear the secret")} (empty the input field)`,
        `→ This switches AnyCable into ${color.italic("public streams")} mode`,
        `→ Click ${color.bold("Next")} and wait for deploy`,
      ].join("\n"),
      "Enable public streams",
    );

    const deployed = await p.confirm({
      message: "Cable deployed?",
      active: "Continue",
      inactive: "Waiting...",
    });
    if (p.isCancel(deployed)) return p.cancel("Cancelled.");

    p.log.success("AnyCable app is ready!");
  }

  // Step 4 — AnyCable URLs + review

  let urls;

  while (true) {
    urls = await p.group(
      {
        wsUrl: () =>
          p.text({
            message: "WebSocket URL",
            placeholder: "wss://your-cable.anycable.io/cable",
            defaultValue: urls?.wsUrl,
            validate: v =>
              v.startsWith("wss://") ? undefined : 'Should start with "wss://"',
          }),
        broadcastUrl: () =>
          p.text({
            message: "Broadcast URL",
            placeholder: "https://your-cable.anycable.io/_broadcast",
            defaultValue: urls?.broadcastUrl,
            validate: v =>
              v.startsWith("https://") ? undefined : 'Should start with "https://"',
          }),
      },
      {
        onCancel: () => {
          p.cancel("Cancelled.");
          process.exit(0);
        },
      },
    );

    const reviewLines = framework === "revealjs"
      ? [
          `HTML file:      ${color.cyan(htmlFile)}`,
          `JS entry:       ${jsEntry ? color.cyan(jsEntry) : color.dim("(manual setup)")}`,
          `Platform:       ${color.cyan(platform)}`,
          `WebSocket URL:  ${color.cyan(urls.wsUrl)}`,
          `Broadcast URL:  ${color.cyan(urls.broadcastUrl)}`,
          `Quiz group:     ${color.cyan(quizGroupId)}`,
        ]
      : [
          `Framework:      ${color.cyan("Slidev")}`,
          `Platform:       ${color.cyan(platform)}`,
          `WebSocket URL:  ${color.cyan(urls.wsUrl)}`,
          `Broadcast URL:  ${color.cyan(urls.broadcastUrl)}`,
          `Quiz group:     ${color.cyan(quizGroupId)}`,
        ];

    p.note(reviewLines.join("\n"), "Review your settings");

    const confirmLabel = framework === "revealjs"
      ? "Yes, install slide-quiz"
      : "Yes, install slidev-addon-slide-quiz";

    const reviewAction = await p.select({
      message: "Look good?",
      options: [
        { value: "confirm", label: confirmLabel },
        { value: "edit_platform", label: "Change platform" },
        { value: "edit_urls", label: "Change AnyCable URLs" },
      ],
    });
    if (p.isCancel(reviewAction)) return p.cancel("Cancelled.");

    if (reviewAction === "confirm") break;

    if (reviewAction === "edit_platform") {
      const newPlatform = await p.select({
        message: "Deploy platform",
        options: PLATFORM_OPTIONS,
      });
      if (!p.isCancel(newPlatform)) platform = newPlatform;
    }
    // edit_urls falls through to next iteration
  }

  // Step 5 — Install + create files

  const isVercel = platform === "vercel";
  const isCloudflare = platform === "cloudflare";
  const needsEndpoints = isVercel || isCloudflare;
  const customEndpoints = needsEndpoints
    ? '\n  endpoints: { answer: "/api/quiz-answer", sync: "/api/quiz-sync" },'
    : "";

  if (framework === "revealjs") {
    s.start("Installing slide-quiz...");
    let npmInstallOk = false;
    try {
      execSync("npm install slide-quiz @anycable/serverless-js", { cwd: dir, stdio: "pipe", timeout: CMD_TIMEOUT });
      s.stop("slide-quiz installed!");
      npmInstallOk = true;
    } catch {
      s.stop(color.yellow("npm install failed — run `npm install slide-quiz @anycable/serverless-js` manually."));
    }

    if (!existsSync(join(dir, "quiz.html"))) {
      writeFileSync(
        join(dir, "quiz.html"),
        `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Quiz — Join</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { height: 100%; }
    </style>
  </head>
  <body>
    <div id="quiz-root"></div>
    <script type="module" src="/quiz.js"></script>
  </body>
</html>
`,
      );
      p.log.success("Created quiz.html");
    } else {
      p.log.info("quiz.html already exists — skipped.");
    }

    if (!existsSync(join(dir, "quiz.js"))) {
      writeFileSync(
        join(dir, "quiz.js"),
        `import { createParticipantUI } from "slide-quiz/participant";
import "slide-quiz/participant.css";

createParticipantUI("#quiz-root", {
  wsUrl: "${urls.wsUrl}",
  quizGroupId: "${quizGroupId}",${customEndpoints}
});
`,
      );
      p.log.success("Created quiz.js");
    } else {
      p.log.info("quiz.js already exists — skipped.");
    }
  } else {
    // Slidev
    s.start("Installing slidev-addon-slide-quiz...");
    let npmInstallOk = false;
    try {
      execSync("npm install slidev-addon-slide-quiz @anycable/serverless-js", { cwd: dir, stdio: "pipe", timeout: CMD_TIMEOUT });
      s.stop("slidev-addon-slide-quiz installed!");
      npmInstallOk = true;
    } catch {
      s.stop(color.yellow("npm install failed — run `npm install slidev-addon-slide-quiz @anycable/serverless-js` manually."));
    }

    // Copy quiz.html to public/
    mkdirSync(join(dir, "public"), { recursive: true });
    const addonPublicDir = join(dir, "node_modules", "slidev-addon-slide-quiz", "public");

    if (npmInstallOk && existsSync(addonPublicDir)) {
      if (!existsSync(join(dir, "public", "quiz.html"))) {
        copyFileSync(join(addonPublicDir, "quiz.html"), join(dir, "public", "quiz.html"));
        p.log.success("Copied quiz.html to public/");
      } else {
        p.log.info("public/quiz.html already exists — skipped.");
      }

      // Copy _redirects for Netlify
      if (platform === "netlify" && !existsSync(join(dir, "public", "_redirects"))) {
        const redirectsSrc = join(addonPublicDir, "_redirects");
        if (existsSync(redirectsSrc)) {
          copyFileSync(redirectsSrc, join(dir, "public", "_redirects"));
          p.log.success("Copied _redirects to public/");
        }
      }
    } else if (!npmInstallOk) {
      p.log.warn("Skipping file copies — install the packages first, then re-run create-slide-quiz-plus.");
    }
  }

  // Copy serverless functions (shared source from slide-quiz)
  const functionsSource = join(dir, "node_modules", "slide-quiz", "functions");

  if (!existsSync(functionsSource)) {
    p.log.warn("Could not find serverless function templates — install slide-quiz first, then re-run.");
  } else if (platform === "netlify") {
    const fnDir = join(dir, "netlify", "functions");
    mkdirSync(fnDir, { recursive: true });
    for (const f of readdirSync(join(functionsSource, "netlify"))) {
      if (!existsSync(join(fnDir, f))) {
        copyFileSync(join(functionsSource, "netlify", f), join(fnDir, f));
      }
    }
    p.log.success("Created netlify/functions/");

    if (!existsSync(join(dir, "netlify.toml"))) {
      const buildCmd = framework === "slidev" ? "npx slidev build" : "npm run build";
      writeFileSync(
        join(dir, "netlify.toml"),
        `[build]\n  command = "${buildCmd}"\n  publish = "dist"\n  functions = "netlify/functions"\n\n[build.environment]\n  NODE_VERSION = "22"\n`,
      );
      p.log.success("Created netlify.toml");
    }
  } else if (platform === "vercel") {
    const apiDir = join(dir, "api");
    mkdirSync(apiDir, { recursive: true });
    for (const f of readdirSync(join(functionsSource, "vercel"))) {
      if (!existsSync(join(apiDir, f))) {
        copyFileSync(join(functionsSource, "vercel", f), join(apiDir, f));
      }
    }
    p.log.success("Created api/");
  } else if (platform === "cloudflare") {
    // Cloudflare templates are bundled with this CLI (not in node_modules/slide-quiz)
    const cfSource = join(__dirname, "templates", "cloudflare");
    const apiSource = join(cfSource, "api");

    const fnDir = join(dir, "functions", "api");
    mkdirSync(fnDir, { recursive: true });
    for (const f of readdirSync(apiSource)) {
      if (!existsSync(join(fnDir, f))) {
        copyFileSync(join(apiSource, f), join(fnDir, f));
      }
    }
    p.log.success("Created functions/api/");

    const wranglerPath = join(dir, "wrangler.toml");
    if (!existsSync(wranglerPath)) {
      const cfName = sanitizeCloudflareName(quizGroupId);
      const wranglerContent = readFileSync(join(cfSource, "wrangler.toml"), "utf-8")
        .replace(/^name\s*=\s*".*"/m, `name = "${cfName}"`);
      writeFileSync(wranglerPath, wranglerContent);
      p.log.success("Created wrangler.toml");
    } else {
      p.log.info("wrangler.toml already exists — skipped.");
    }

    ensureGitignore(dir, ".wrangler");
    ensureGitignore(dir, ".dev.vars");
  }

  // .env
  if (!existsSync(join(dir, ".env"))) {
    writeFileSync(join(dir, ".env"), `ANYCABLE_BROADCAST_URL=${urls.broadcastUrl}\n`);
    p.log.success("Created .env");
  } else {
    const envContent = readFileSync(join(dir, ".env"), "utf-8");
    if (!envContent.includes("ANYCABLE_BROADCAST_URL")) {
      appendFileSync(join(dir, ".env"), `\nANYCABLE_BROADCAST_URL=${urls.broadcastUrl}\n`);
      p.log.success("Added ANYCABLE_BROADCAST_URL to .env");
    } else {
      p.log.info(".env already has ANYCABLE_BROADCAST_URL — skipped.");
    }
  }

  // Cloudflare uses .dev.vars for local Wrangler dev
  if (isCloudflare) {
    const devVarsPath = join(dir, ".dev.vars");
    if (!existsSync(devVarsPath)) {
      writeFileSync(devVarsPath, `ANYCABLE_BROADCAST_URL=${urls.broadcastUrl}\n`);
      p.log.success("Created .dev.vars (for local Wrangler dev)");
    } else {
      const devContent = readFileSync(devVarsPath, "utf-8");
      if (!devContent.includes("ANYCABLE_BROADCAST_URL")) {
        appendFileSync(devVarsPath, `\nANYCABLE_BROADCAST_URL=${urls.broadcastUrl}\n`);
        p.log.success("Added ANYCABLE_BROADCAST_URL to .dev.vars");
      }
    }
  }

  ensureGitignore(dir, "node_modules");
  ensureGitignore(dir, "dist");
  ensureGitignore(dir, ".vite");
  ensureGitignore(dir, ".env");

  // Initialize git if not already a repo
  if (!existsSync(join(dir, ".git"))) {
    try {
      execSync("git init", { cwd: dir, stdio: "pipe", timeout: CMD_TIMEOUT });
      p.log.success("Initialized git repository");
    } catch {
      // git not installed — not critical
    }
  }

  // Step 6 — Framework-specific modifications

  if (framework === "revealjs") {
    // Auto-modify HTML
    const inserted = insertQuizSlides(dir, htmlFile);
    if (inserted === "exists") {
      p.log.info(`Quiz slides already present in ${htmlFile} — skipped.`);
    } else if (inserted) {
      p.log.success(`Added sample quiz slides to ${htmlFile}`);
    } else {
      p.log.warn(`Could not auto-insert quiz slides into ${htmlFile} — add them manually.`);
    }

    // Auto-inject plugin
    const slideQuizConfig = [
      `    plugins: [RevealSlideQuiz],`,
      `    slideQuiz: {`,
      `      wsUrl: "${urls.wsUrl}",`,
      `      quizGroupId: "${quizGroupId}",`,
      "      quizUrl: `${window.location.origin}/quiz.html`,",
      needsEndpoints ? '      endpoints: { answer: "/api/quiz-answer", sync: "/api/quiz-sync" },' : null,
      `    },`,
    ].filter(Boolean).join("\n");

    if (jsEntry) {
      // Existing JS entry — inject imports + config
      const jsPath = join(dir, jsEntry);
      let js = readFileSync(jsPath, "utf-8");

      if (js.includes("slide-quiz")) {
        p.log.info(`${jsEntry} already has slide-quiz configured — skipped.`);
      } else {
        const importLines = 'import RevealSlideQuiz from "slide-quiz";\nimport "slide-quiz/style.css";';
        const firstImport = js.match(/^import\s/m);
        if (firstImport) {
          js = js.slice(0, firstImport.index) + importLines + "\n" + js.slice(firstImport.index);
        } else {
          js = importLines + "\n\n" + js;
        }

        const pluginsMatch = js.match(/plugins\s*:\s*\[/);
        if (pluginsMatch) {
          const pos = pluginsMatch.index + pluginsMatch[0].length;
          js = js.slice(0, pos) + "RevealSlideQuiz, " + js.slice(pos);
          const initMatch = js.match(/Reveal\.(initialize|configure)\s*\(\s*\{/);
          if (initMatch) {
            const pos2 = initMatch.index + initMatch[0].length;
            const sqOnly = slideQuizConfig.split("\n").filter(l => !l.includes("plugins")).join("\n");
            js = js.slice(0, pos2) + "\n" + sqOnly + "\n" + js.slice(pos2);
          }
        } else {
          const initMatch = js.match(/Reveal\.(initialize|configure)\s*\(\s*\{/);
          if (initMatch) {
            const pos = initMatch.index + initMatch[0].length;
            js = js.slice(0, pos) + "\n" + slideQuizConfig + "\n" + js.slice(pos);
          }
        }

        writeFileSync(jsPath, js);
        p.log.success(`Updated ${jsEntry} with slide-quiz plugin`);
      }

    } else {
      // Standalone HTML — extract inline script to main.js + set up Vite

      const htmlPath = join(dir, htmlFile);
      let html = readFileSync(htmlPath, "utf-8");

      const scriptRe = /<script(?![^>]*\bsrc\b)[^>]*>([\s\S]*?)<\/script>/g;
      let scriptMatch;
      let revealScript = null;
      while ((scriptMatch = scriptRe.exec(html)) !== null) {
        if (REVEAL_INIT_RE.test(scriptMatch[1])) {
          revealScript = scriptMatch;
          break;
        }
      }

      if (revealScript) {
        const body = revealScript[1];
        const initMatch = body.match(/Reveal\.(initialize|configure)\s*\(\s*\{/);

        if (initMatch) {
          let depth = 1, start = initMatch.index + initMatch[0].length, idx = start;
          while (idx < body.length && depth > 0) {
            if (body[idx] === "{") depth++;
            else if (body[idx] === "}") depth--;
            idx++;
          }
          const configInner = body.slice(start, idx - 1).trim();

          const mainJs = [
            'import Reveal from "reveal.js";',
            'import "reveal.js/dist/reveal.css";',
            'import RevealSlideQuiz from "slide-quiz";',
            'import "slide-quiz/style.css";',
            "",
            "Reveal.initialize({",
            slideQuizConfig,
            `    ${configInner}`,
            "});",
            "",
          ].join("\n");

          writeFileSync(join(dir, "main.js"), mainJs);
          p.log.success("Created main.js with slide-quiz plugin");

          // Remove CDN-loaded reveal.js assets
          html = html.replace(/\s*<link[^>]*href="https?:\/\/[^"]*reveal[^"]*"[^>]*>/g, "");
          html = html.replace(/\s*<script[^>]*src="https?:\/\/[^"]*reveal[^"]*"[^>]*>\s*<\/script>/g, "");

          // Replace inline script with module entry
          html = html.replace(revealScript[0], '<script type="module" src="/main.js"></script>');

          writeFileSync(htmlPath, html);
          p.log.success(`Updated ${htmlFile} — switched to module imports`);
        }
      } else {
        p.log.warn(`Could not find Reveal.initialize() in ${htmlFile} — add plugin config manually.`);
      }

      // Set up Vite if not already present
      if (!viteConfig) {
        s.start("Installing vite...");
        try {
          execSync("npm install -D vite", { cwd: dir, stdio: "pipe", timeout: CMD_TIMEOUT });
          s.stop("Vite installed!");
        } catch {
          s.stop("Could not install vite — run `npm install -D vite` manually.");
        }

        writeFileSync(
          join(dir, "vite.config.js"),
          [
            'import { resolve } from "path";',
            "",
            "export default {",
            "  build: {",
            "    rollupOptions: {",
            "      input: {",
            `        main: resolve(import.meta.dirname, "${htmlFile}"),`,
            '        quiz: resolve(import.meta.dirname, "quiz.html"),',
            "      },",
            "    },",
            "  },",
            "};",
            "",
          ].join("\n"),
        );
        p.log.success("Created vite.config.js");

        pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        pkg.scripts = pkg.scripts || {};
        if (!pkg.scripts.dev) pkg.scripts.dev = "vite";
        if (!pkg.scripts.build) pkg.scripts.build = "vite build";
        if (!pkg.scripts.preview) pkg.scripts.preview = "vite preview";
        writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
        p.log.success("Added dev/build/preview scripts to package.json");
      }
    }

    // Vite config snippet (only if user already had one)
    if (viteConfig) {
      p.note(
        [
          color.dim("// Add quiz.html as a second entry point:"),
          color.cyan("build: {"),
          color.cyan("  rollupOptions: {"),
          color.cyan("    input: {"),
          color.cyan(`      main: resolve(import.meta.dirname, "${htmlFile}"),`),
          color.cyan('      quiz: resolve(import.meta.dirname, "quiz.html"),'),
          color.cyan("    },"),
          color.cyan("  },"),
          color.cyan("},"),
        ].join("\n"),
        `Update ${viteConfig}`,
      );
    }

  } else {
    // Slidev — modify slides.md
    const slidesPath = join(dir, "slides.md");

    if (existsSync(slidesPath)) {
      modifySlidesConfig(dir, urls.wsUrl, quizGroupId, needsEndpoints);
      p.log.success("Updated slides.md headmatter with quiz configuration");

      const slidesContent = readFileSync(slidesPath, "utf-8");
      if (slidesContent.includes("layout: quiz")) {
        p.log.info("Quiz slides already present in slides.md — skipped.");
      } else {
        appendFileSync(slidesPath, SLIDEV_QUIZ_SLIDES);
        p.log.success("Added sample quiz slides to slides.md");
      }
    } else {
      const frontmatter = [
        "---",
        "addons:",
        "  - slidev-addon-slide-quiz",
        "slideQuiz:",
        `  wsUrl: ${urls.wsUrl}`,
        `  quizGroupId: ${quizGroupId}`,
        "  quizUrl: /quiz.html",
        needsEndpoints ? "  endpoints:\n    answer: /api/quiz-answer\n    sync: /api/quiz-sync" : null,
        "---",
      ].filter(Boolean).join("\n");

      writeFileSync(
        slidesPath,
        frontmatter + "\n\n# Welcome\n\nYour Slidev presentation\n" + SLIDEV_QUIZ_SLIDES,
      );
      p.log.success("Created slides.md with quiz configuration");
    }
  }

  // Step 7 — Deploy guidance

  const buildCmd = framework === "slidev" ? "npx slidev build" : "npm run build";
  const devCmd = framework === "slidev" ? "npx slidev" : "npm run dev";
  let deployed = false;
  let siteUrl = "";

  let gitRemoteUrl = "";
  try {
    gitRemoteUrl = execSync("git remote get-url origin", { cwd: dir, stdio: "pipe", timeout: CMD_TIMEOUT })
      .toString()
      .trim();
  } catch {
    // no remote
  }

  const repoName = gitRemoteUrl
    ? gitRemoteUrl.replace(/.*[:/](.+\/.+?)(?:\.git)?$/, "$1")
    : quizGroupId;

  if (platform === "netlify") {
    const hasNetlify = hasCommand("netlify");

    if (hasNetlify) {
      const useNetlifyCli = await p.confirm({
        message: "Netlify CLI detected. Link and deploy now?",
        initialValue: true,
      });

      if (useNetlifyCli && !p.isCancel(useNetlifyCli)) {
        const alreadyLinked = existsSync(join(dir, ".netlify", "state.json"));
        let initOk = alreadyLinked;

        if (alreadyLinked) {
          p.log.info("Netlify site already linked — skipping site creation.");
        } else {
          p.log.step("Creating Netlify site...");
          try {
            run("netlify sites:create --manual", dir, DEPLOY_TIMEOUT);
            initOk = true;
          } catch {
            p.log.warn("Site creation failed — you can run `netlify sites:create` later.");
          }
        }

        if (initOk) {
          s.start("Setting environment variables...");
          try {
            execSync(`netlify env:set ANYCABLE_BROADCAST_URL "${urls.broadcastUrl}"`, {
              cwd: dir,
              stdio: "pipe",
              timeout: CMD_TIMEOUT,
            });
            s.stop("Environment variables set on Netlify!");
          } catch {
            s.stop("Could not set env vars — set them in the Netlify dashboard.");
          }

          const deploy = await p.confirm({
            message: "Build and deploy to production?",
            initialValue: true,
          });

          if (deploy && !p.isCancel(deploy)) {
            s.start("Building and deploying...");
            try {
              const deployOutput = execSync(`${buildCmd} && netlify deploy --prod --dir=dist`, {
                cwd: dir,
                stdio: "pipe",
                timeout: DEPLOY_TIMEOUT,
              }).toString();
              deployed = true;
              const urlMatch = deployOutput.match(/Website URL:\s*(https?:\/\/\S+)/);
              if (urlMatch) siteUrl = urlMatch[1];
              if (!siteUrl) {
                try {
                  const state = JSON.parse(readFileSync(join(dir, ".netlify", "state.json"), "utf-8"));
                  if (state.name) siteUrl = `https://${state.name}.netlify.app`;
                } catch { /* ignore */ }
              }
              s.stop(siteUrl ? `Deployed to ${color.cyan(siteUrl)}` : "Deployed to Netlify!");
            } catch {
              s.stop(`Deploy failed — try \`${buildCmd} && netlify deploy --prod --dir=dist\` manually.`);
            }
          }
        } else {
          p.note(
            [
              `1. Run ${color.cyan("netlify sites:create --manual")} to create a site`,
              `2. Re-run ${color.cyan("npx create-slide-quiz-plus")} to finish setup`,
              "",
              `Or deploy manually:`,
              `  ${color.cyan(`netlify env:set ANYCABLE_BROADCAST_URL "${urls.broadcastUrl}"`)}`,
              `  ${color.cyan(`${buildCmd} && netlify deploy --prod --dir=dist`)}`,
            ].join("\n"),
            "When you're ready to deploy",
          );
        }
      }
    } else {
      p.note(
        [
          `1. Click ${color.bold("Import an existing project")}`,
          gitRemoteUrl
            ? `2. Connect your GitHub repo: ${color.cyan(repoName)}`
            : `2. Connect your GitHub repo`,
          `3. Build command: ${color.cyan(buildCmd)}`,
          `4. Publish directory: ${color.cyan("dist")}`,
          `5. Add environment variable:`,
          `   ${color.cyan("ANYCABLE_BROADCAST_URL")} = ${urls.broadcastUrl}`,
          `6. Click Deploy!`,
          "",
          `Or install the CLI: ${color.cyan("npm i -g netlify-cli")}`,
        ].join("\n"),
        "Deploy to Netlify",
      );
    }
  } else if (platform === "vercel") {
    const hasVercelCli = hasCommand("vercel");

    if (hasVercelCli) {
      const useVercelCli = await p.confirm({
        message: "Vercel CLI detected. Link and deploy now?",
        initialValue: true,
      });

      if (useVercelCli && !p.isCancel(useVercelCli)) {
        p.log.step("Running `vercel link`...");
        let linkOk = false;
        try {
          run("vercel link", dir, DEPLOY_TIMEOUT);
          linkOk = true;
        } catch {
          p.log.warn("vercel link failed — you can run it later.");
        }

        if (linkOk) {
          s.start("Setting environment variables...");
          try {
            execSync(
              `echo "${urls.broadcastUrl}" | vercel env add ANYCABLE_BROADCAST_URL production`,
              { cwd: dir, stdio: "pipe", timeout: CMD_TIMEOUT },
            );
            s.stop("Environment variables set on Vercel!");
          } catch {
            s.stop("Could not set env vars — set them in the Vercel dashboard.");
          }

          const deploy = await p.confirm({
            message: "Deploy to production?",
            initialValue: true,
          });

          if (deploy && !p.isCancel(deploy)) {
            s.start("Deploying...");
            try {
              const vercelOutput = execSync("vercel --prod", { cwd: dir, stdio: "pipe", timeout: DEPLOY_TIMEOUT }).toString();
              deployed = true;
              const vercelUrlMatch = vercelOutput.match(/(https?:\/\/\S+\.vercel\.app)/);
              if (vercelUrlMatch) siteUrl = vercelUrlMatch[1];
              s.stop(siteUrl ? `Deployed to ${color.cyan(siteUrl)}` : "Deployed to Vercel!");
            } catch {
              s.stop("Deploy failed — try `vercel --prod` manually.");
            }
          }
        } else {
          p.note(
            [
              `1. Run ${color.cyan("vercel link")} to link your project`,
              `2. Re-run ${color.cyan("npx create-slide-quiz-plus")} to finish setup`,
              "",
              `Or deploy manually:`,
              `  ${color.cyan(`echo "${urls.broadcastUrl}" | vercel env add ANYCABLE_BROADCAST_URL production`)}`,
              `  ${color.cyan("vercel --prod")}`,
            ].join("\n"),
            "When you're ready to deploy",
          );
        }
      }
    } else {
      const frameworkPreset = framework === "slidev" ? "Other" : "Vite";
      p.note(
        [
          `1. Click ${color.bold("Import Git Repository")}`,
          gitRemoteUrl
            ? `2. Select your repo: ${color.cyan(repoName)}`
            : `2. Select your repo`,
          `3. Framework preset: ${color.cyan(frameworkPreset)}`,
          framework === "slidev" ? `   Build command: ${color.cyan(buildCmd)}` : null,
          framework === "slidev" ? `   Output directory: ${color.cyan("dist")}` : null,
          `4. Add environment variable:`,
          `   ${color.cyan("ANYCABLE_BROADCAST_URL")} = ${urls.broadcastUrl}`,
          `5. Click Deploy!`,
          "",
          `Or install the CLI: ${color.cyan("npm i -g vercel")}`,
        ].filter(Boolean).join("\n"),
        "Deploy to Vercel",
      );
    }
  } else {
    // Cloudflare Pages
    const hasWrangler = hasCommand("wrangler");
    const cfName = sanitizeCloudflareName(quizGroupId);
    const deployCmd = `wrangler pages deploy dist --project-name=${cfName}`;

    if (hasWrangler) {
      const useWrangler = await p.confirm({
        message: "Wrangler CLI detected. Create the Pages project and deploy now?",
        initialValue: true,
      });

      if (useWrangler && !p.isCancel(useWrangler)) {
        p.log.step("Creating Cloudflare Pages project...");
        let projectOk = false;
        try {
          execSync(
            `wrangler pages project create ${cfName} --production-branch=main`,
            { cwd: dir, stdio: "pipe", timeout: DEPLOY_TIMEOUT },
          );
          projectOk = true;
          p.log.success(`Created Cloudflare Pages project "${cfName}"`);
        } catch (err) {
          const message = String(err?.stderr || err?.message || "");
          if (/already exists/i.test(message)) {
            p.log.info(`Pages project "${cfName}" already exists — reusing.`);
            projectOk = true;
          } else {
            p.log.warn(`Could not create Pages project — you may need to run \`wrangler login\` first.`);
          }
        }

        if (projectOk) {
          s.start("Setting ANYCABLE_BROADCAST_URL secret...");
          try {
            execSync(
              `printf '%s' "${urls.broadcastUrl}" | wrangler pages secret put ANYCABLE_BROADCAST_URL --project-name=${cfName}`,
              { cwd: dir, stdio: "pipe", timeout: CMD_TIMEOUT, shell: "/bin/sh" },
            );
            s.stop("Secret set on Cloudflare Pages!");
          } catch {
            s.stop("Could not set secret — set ANYCABLE_BROADCAST_URL in the Cloudflare dashboard.");
          }

          const deploy = await p.confirm({
            message: "Build and deploy to production?",
            initialValue: true,
          });

          if (deploy && !p.isCancel(deploy)) {
            s.start("Building and deploying...");
            try {
              const deployOutput = execSync(`${buildCmd} && ${deployCmd}`, {
                cwd: dir,
                stdio: "pipe",
                timeout: DEPLOY_TIMEOUT,
              }).toString();
              deployed = true;
              const urlMatch = deployOutput.match(/(https?:\/\/\S+\.pages\.dev)/);
              if (urlMatch) siteUrl = urlMatch[1];
              if (!siteUrl) siteUrl = `https://${cfName}.pages.dev`;
              s.stop(`Deployed to ${color.cyan(siteUrl)}`);
            } catch {
              s.stop(`Deploy failed — try \`${buildCmd} && ${deployCmd}\` manually.`);
            }
          }
        } else {
          p.note(
            [
              `1. Run ${color.cyan("wrangler login")} (if not authenticated)`,
              `2. Run ${color.cyan(`wrangler pages project create ${cfName} --production-branch=main`)}`,
              `3. Re-run ${color.cyan("npx create-slide-quiz-plus")} to finish setup`,
              "",
              `Or deploy manually:`,
              `  ${color.cyan(`printf '%s' "${urls.broadcastUrl}" | wrangler pages secret put ANYCABLE_BROADCAST_URL --project-name=${cfName}`)}`,
              `  ${color.cyan(`${buildCmd} && ${deployCmd}`)}`,
            ].join("\n"),
            "When you're ready to deploy",
          );
        }
      }
    } else {
      p.note(
        [
          `1. Go to ${color.underline("https://dash.cloudflare.com")} > Workers & Pages > Create > Pages`,
          gitRemoteUrl
            ? `2. Connect your GitHub repo: ${color.cyan(repoName)}`
            : `2. Connect your GitHub repo`,
          `3. Build command: ${color.cyan(buildCmd)}`,
          `4. Build output directory: ${color.cyan("dist")}`,
          `5. Add environment variable (Settings > Variables and Secrets):`,
          `   ${color.cyan("ANYCABLE_BROADCAST_URL")} = ${urls.broadcastUrl}`,
          `6. Save and Deploy!`,
          "",
          `Or install the CLI: ${color.cyan("npm i -g wrangler")}`,
        ].join("\n"),
        "Deploy to Cloudflare Pages",
      );
    }
  }

  // Step 8 — Done

  const editFile = framework === "slidev" ? "slides.md" : htmlFile;
  const steps = [];
  if (framework === "revealjs" && viteConfig) {
    steps.push(`Update ${color.bold(viteConfig)} to add quiz.html entry point (see above)`);
  }
  steps.push(`Edit your quiz slides in ${color.bold(editFile)} — change questions, options, or add more!`);
  if (deployed && siteUrl) {
    steps.push(`Your presentation is live at ${color.bold(siteUrl)}`);
    steps.push(`Run ${color.bold(devCmd)} to develop locally`);
  } else if (deployed) {
    steps.push(`Your presentation is live!`);
    steps.push(`Run ${color.bold(devCmd)} to develop locally`);
  } else {
    steps.push(`Run ${color.bold(devCmd)} and try your quiz!`);
    steps.push(`Commit and push to deploy`);
  }

  p.note(steps.map((s, i) => `${i + 1}. ${s}`).join("\n"), "Next steps");

  p.outro(color.green("Happy quizzing!"));
}

async function safeMain() {
  try {
    await main();
  } catch (err) {
    if (err?.message?.includes("User force closed")) {
      // Ctrl+C — exit silently
      process.exit(0);
    }
    p.log.error(`Unexpected error: ${err?.message || err}`);
    p.log.info("If this keeps happening, please open an issue at https://github.com/anycable/slide-quiz/issues");
    process.exit(1);
  }
}

export {
  detectFramework, findRevealHtml, findJsEntry, detectPlatform, detectVite,
  insertQuizSlides, modifySlidesConfig, ensureGitignore, sanitizeCloudflareName,
  SLIDEV_QUIZ_SLIDES, PLATFORM_OPTIONS, main, safeMain,
};
