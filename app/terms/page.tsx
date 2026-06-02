import Link from "next/link";

const UPDATED = "June 2, 2026";

const quickFacts = [
  ["Use", "Entertainment only"],
  ["Fan", "Editorial content"],
  ["Brands", "Not affiliated"],
  ["Links", "May pay us"],
  ["Advice", "None given"],
  ["Risk", "As-is app"],
];

const sections = [
  {
    title: "Entertainment Only",
    body:
      "CasterCycle is a game and social Mini App for entertainment, score sharing, and e-bike-themed play. It is provided as-is and as-available. Features, maps, passes, cosmetics, audio, scores, leaderboards, links, chat, and app access may change, pause, reset, fail, or be removed.",
  },
  {
    title: "Editorial Fan Content",
    body:
      "Fan pages, product blurbs, links, videos, coupons, and comparison notes are personal editorial content and general information only. They are not professional advice, product testing, safety certification, warranty review, merchant endorsement, or a promise that any product will fit your needs.",
  },
  {
    title: "No Affiliation",
    body:
      "CasterCycle is independent and is not sponsored by, affiliated with, authorized by, or endorsed by Kingbull, Aventon, Lectric, TST, Farcaster, wallet providers, video platforms, merchants, or any other third party unless explicitly stated in writing. Product names, logos, marks, videos, and links belong to their owners.",
  },
  {
    title: "Affiliate And Advertising Disclosure",
    body:
      "Some product buttons, sale buttons, coupon codes, referral links, or merchant links may be affiliate links or paid/referral links that can compensate CasterCycle or its operator. We try to keep disclosures close to the related content, but you should assume product links may have a commercial relationship.",
  },
  {
    title: "No Advice",
    body:
      "Nothing in CasterCycle is legal, tax, financial, investment, medical, fitness, safety, engineering, product, warranty, insurance, or purchase advice. Do your own research and talk to qualified professionals before making decisions about wallets, taxes, e-bikes, purchases, riding, compliance, or local laws.",
  },
  {
    title: "Product And E-Bike Risks",
    body:
      "Specs, prices, coupons, sale bundles, shipping, taxes, battery range, speed, class ratings, warranties, availability, and local e-bike laws can change or be inaccurate. Real e-bikes can cause injury or property damage. Verify important details with official sellers, manufacturers, manuals, local authorities, and qualified repair or safety professionals before buying or riding.",
  },
  {
    title: "Ride Safely",
    body:
      "Use appropriate safety gear, inspect equipment, follow traffic and trail rules, use lights, ride sober and alert, avoid distracted riding, and ride within your skill level. CasterCycle gameplay does not train you to ride safely in real life.",
  },
  {
    title: "Wallets And Payments",
    body:
      "You control your wallet and approve your own transactions. Network gas, failed transactions, wallet mistakes, tax reporting, local compliance, lost keys, and loss of access are your responsibility. CasterCycle does not custody user funds or guarantee refunds, confirmations, uptime, resale value, third-party wallet behavior, or tax results.",
  },
  {
    title: "Game Passes",
    body:
      "Optional paid passes unlock extra play time, cosmetics, maps, and social areas inside CasterCycle. They are entertainment access only, not an investment, security, sweepstakes, prize, wage, yield, staking, gambling, or financial product. Pass access may be changed, paused, corrected, or revoked for abuse, fraud, errors, security, or legal/compliance reasons.",
  },
  {
    title: "Scores And Social Features",
    body:
      "Scores, leaderboards, lounge messages, profile display, and sharing tools are for fun. They may be moderated, hidden, reset, rate-limited, or removed. Do not post links, private information, illegal content, unsafe instructions, harassment, or anything you do not have rights to share.",
  },
  {
    title: "Third Parties",
    body:
      "Links, videos, merchants, coupons, wallets, chains, Farcaster services, analytics, users, posts, casts, and third-party content are not controlled by CasterCycle. Third parties have their own terms, privacy practices, risks, fees, policies, and availability.",
  },
  {
    title: "Privacy",
    body:
      "The Privacy page explains the app's practical data practices, including local storage, Farcaster profile display, wallet addresses, scores, lounge messages, analytics, affiliate links, and third-party services. Do not use the app if you do not agree with those practices.",
  },
  {
    title: "U.S. Focus And Local Laws",
    body:
      "These terms are written for a U.S.-focused app experience, but laws vary by state, city, trail, platform, merchant, and user location. You are responsible for following the laws and rules that apply to you.",
  },
  {
    title: "No Warranties",
    body:
      "To the maximum extent allowed by law, CasterCycle and its operators disclaim all warranties, including implied warranties of merchantability, fitness for a particular purpose, title, non-infringement, accuracy, availability, safety, and uninterrupted or error-free operation.",
  },
  {
    title: "Limitation Of Liability",
    body:
      "To the maximum extent allowed by law, CasterCycle and its operators are not liable for indirect, incidental, special, consequential, exemplary, punitive, lost-profit, lost-data, transaction, wallet, tax, safety, purchase, product, injury, property, third-party, or platform damages arising from app use, reliance on content, links, or inability to use the app.",
  },
];

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-[#071018] px-4 py-6 text-white">
      <div className="mx-auto max-w-2xl">
        <div className="flex flex-wrap gap-2">
          <Link className="inline-flex min-h-9 items-center rounded-md border border-white/12 bg-white/8 px-3 text-xs font-black uppercase tracking-[0.08em] text-white/70" href="/">
            Back
          </Link>
          <Link className="inline-flex min-h-9 items-center rounded-md border border-[#7cf2ff]/25 bg-[#7cf2ff]/10 px-3 text-xs font-black uppercase tracking-[0.08em] text-[#7cf2ff]" href="/privacy">
            Privacy
          </Link>
        </div>

        <div className="mt-6 rounded-md border border-[#fbe764]/28 bg-[#fbe764]/10 p-4">
          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-[#fbe764]">terms, disclaimer, liability</div>
          <h1 className="mt-2 text-3xl font-black tracking-normal text-white">CasterCycle Terms</h1>
          <p className="mt-2 text-sm font-semibold leading-6 text-white/62">
            Updated {UPDATED}. Short version: play for fun, verify products and laws yourself, control your wallet, and do not treat the app as advice, affiliation, warranty, or a guarantee.
          </p>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {quickFacts.map(([label, value]) => (
            <div key={label} className="rounded-md border border-white/10 bg-white/[0.05] px-3 py-2">
              <div className="text-[9px] font-black uppercase tracking-[0.12em] text-white/38">{label}</div>
              <div className="mt-1 text-sm font-black text-white">{value}</div>
            </div>
          ))}
        </div>

        <div className="mt-4 space-y-3">
          {sections.map((section) => (
            <section key={section.title} className="rounded-md border border-white/10 bg-white/[0.05] p-4">
              <h2 className="text-sm font-black uppercase tracking-[0.12em] text-white">{section.title}</h2>
              <p className="mt-2 text-sm font-semibold leading-6 text-white/62">{section.body}</p>
            </section>
          ))}
        </div>

        <div className="mt-4 rounded-md border border-[#7cf2ff]/20 bg-[#7cf2ff]/8 p-4 text-sm font-semibold leading-6 text-white/58">
          This page is practical app copy and a risk disclosure, not attorney-drafted legal advice. Before public launch, paid passes, affiliate promos, or broad U.S. distribution, have qualified counsel review the final flow, policies, disclosures, and state-specific requirements.
        </div>
      </div>
    </main>
  );
}
