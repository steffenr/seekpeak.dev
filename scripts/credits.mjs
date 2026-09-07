// Single source of truth for the free-credits offers is credits.json at the repo
// root. These builders turn it into the /free-credits/ offer cards, the page's
// FAQ JSON-LD, the homepage/omp CTA copy and the free-credits.gist.md mirror.
// Every Tailwind class used in the cards appears here as a complete literal so
// the JIT scanner (see the @source line in src/style.css) keeps it.

const NUMBER_WORDS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight",
  "nine", "ten", "eleven", "twelve",
];

const numberWord = (n) => NUMBER_WORDS[n] || String(n);

export const offerId = (provider) =>
  "offer-" + provider.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// 1-5 → "★★★★☆" (filled + hollow to five).
export const stars = (n) => {
  const filled = Math.max(0, Math.min(5, Math.round(n || 0)));
  return "★".repeat(filled) + "☆".repeat(5 - filled);
};

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const modelChip = (id) =>
  `<span class="rounded-md border-2 border-black bg-mk-input px-2.5 py-1 text-xs font-black text-mk-fg shadow-[2px_2px_0px_0px_#000000]">${esc(id)}</span>`;

const offerCard = (o) => {
  const cardBg = "bg-mk-card";
  const btnBg = o.featured ? "bg-mk-pink" : "bg-mk-green";
  const note = o.note
    ? `\n          <p class="mt-3 text-xs font-bold uppercase tracking-wide text-mk-muted">\n            ${o.note}\n          </p>`
    : "";
  return `        <article id="${offerId(o.provider)}" class="mt-3 rounded-md border-2 border-black ${cardBg} p-5 shadow-[6px_6px_0px_0px_#000000]">
          <a
            href="${esc(o.url)}"
            target="_blank"
            rel="noopener sponsored"
            class="block rounded-md border-2 border-black ${btnBg} px-4 py-3 text-center text-base font-black uppercase tracking-wide text-mk-ink shadow-[4px_4px_0px_0px_#000000] transition-all hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0px_0px_#000000] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none sm:text-lg"
          >
            ${esc(o.provider)} - ${esc(o.credits)}
          </a>
          <div class="mt-3">
            <span class="block text-xs font-black uppercase tracking-wider text-mk-cyan">Models</span>
            <div class="mt-2 flex flex-wrap gap-2">
              ${o.models.map(modelChip).join("\n              ")}
            </div>
          </div>${note}
        </article>`;
};

export const offerCardsHtml = (offers) => offers.map(offerCard).join("\n\n");

// "… currently has seven verified offers: B.Ai (300,000 credits), … and
// Vyceai.com ($40). Each one adds credit to a new account on registration."
export const faqProvidersText = (offers) => {
  const parts = offers.map((o) => `${o.provider} (${o.creditsShort})`);
  const list =
    parts.length > 1
      ? parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1]
      : parts[0];
  return `The list currently has ${numberWord(offers.length)} verified offers: ${list}. Each one adds credit to a new account on registration.`;
};

// CTA copy on the homepage and omp page. Uses the first dollar-denominated
// offer (a "$120" reads better in the CTA than "300,000 credits"), else the
// first offer.
export const creditCtaText = (offers) => {
  const pick = offers.find((o) => /^\$/.test(o.creditsShort)) || offers[0];
  return `Free credits — ${pick.creditsShort} to start`;
};

const gistSection = (o) => {
  const lines = [`### ${o.provider} — ${o.credits.replace(/Credits$/, "credits")}`, ""];
  if (o.blurb) lines.push(o.blurb, "");
  lines.push(`- **Claim:** ${o.url}`);
  lines.push(`- **Models:** ${o.models.map((m) => "`" + m + "`").join(", ")}`);
  return lines.join("\n");
};

const gistRow = (o) =>
  `| [${o.provider}](${o.url}) | ${o.creditsShort} | ${o.models.join(", ")} |`;

export const gistMarkdown = (offers) =>
  `# Free AI Model Credits — a hand-checked list of working sign-up offers

Most model gateways will front you credit just for making an account — no card, no
commitment. It is the cheapest way to find out how a model actually behaves on *your*
prompts before you spend a cent. The problem is that half the offers you find online are
dead, capped to a trial you can't use for real work, or quietly gated behind a card.

This is a short list of the ones that currently **pay out and work with a normal coding
tool** (Claude Code, Codex, Cursor, opencode, oh-my-pi, …). Every entry is an Anthropic-
or OpenAI-compatible endpoint: point your client at the base URL, paste the key, burn the
free balance on real work.

> Live version (kept up to date): **https://seekpeak.dev/free-credits/**

---

## Working offers

${offers.map(gistSection).join("\n\n")}

---

## At a glance

| Provider | Credit | Models |
| --- | --- | --- |
${offers.map(gistRow).join("\n")}

---

## How this list works

- **Checked by hand.** An entry only stays here while the credit still shows up on a
  fresh account. Dead offers get pulled.
- **The provider sets the terms.** Credit amount, expiry and rate limits are decided by
  each provider and can change without notice.
- **Model ids drift.** The lists above are a snapshot — names move as providers add and
  retire releases.
- **Referral disclosure.** Every link here is a referral link. It costs you nothing extra
  and may send some credit our way. The offer itself is the provider's standard sign-up
  bonus, not something negotiated for this list.

---

*Not affiliated with deepseek.com. Each credit offer and its terms are set by the
provider. Maintained alongside [Seek Peak](https://seekpeak.dev/).*
`;
