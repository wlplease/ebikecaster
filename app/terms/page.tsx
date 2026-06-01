import Link from "next/link";

const UPDATED = "June 1, 2026";

const sections = [
  {
    title: "Entertainment Only",
    body:
      "CasterCycle is a Farcaster Mini App game for fun, social sharing, and e-bike-themed play. It is provided as-is and as-available. Scores, leaderboards, cosmetics, audio, maps, links, rewards, and app features may change, pause, reset, fail, or be removed.",
  },
  {
    title: "No Advice",
    body:
      "Nothing in CasterCycle is financial, investment, legal, tax, safety, medical, warranty, or purchase advice. Do your own research and talk to qualified professionals before making decisions about wallets, taxes, e-bikes, riding, purchases, or local laws.",
  },
  {
    title: "Wallets And Payments",
    body:
      "You control your wallet and approve your own transactions. Network gas, failed transactions, wallet mistakes, tax reporting, local compliance, and loss of access are your responsibility. CasterCycle does not custody user funds or guarantee refunds, confirmations, uptime, resale value, rewards, or third-party wallet behavior.",
  },
  {
    title: "Game Passes",
    body:
      "Optional paid passes unlock extra play time, cosmetics, maps, and social areas inside CasterCycle. They are entertainment access only, not an investment, prize, reward program, security, sweepstakes, wage, yield, staking, or financial product. Pass access may be paused, corrected, changed, or revoked for abuse, fraud, errors, security, or legal/compliance reasons.",
  },
  {
    title: "Kingbull Fan Content",
    body:
      "The Kingbull Ranger area is unaffiliated fan content. CasterCycle is not sponsored by, affiliated with, or endorsed by Kingbull. Product names, marks, videos, specs, prices, promotions, availability, shipping, warranties, and local e-bike rules can change. Promo buttons may be affiliate links that compensate us. Verify all important details with Kingbull and local authorities before buying or riding.",
  },
  {
    title: "Ride Safely",
    body:
      "Real e-bikes can be dangerous. Wear appropriate safety gear, inspect equipment, follow traffic laws, respect trail rules, use lights, ride within your skill level, and never ride distracted. CasterCycle gameplay does not train you to ride safely in real life.",
  },
  {
    title: "No Endorsement",
    body:
      "Links, videos, products, wallets, chains, users, posts, casts, scores, or third-party content shown in the app are not endorsements or guarantees. Third-party services have their own terms, risks, privacy practices, and availability.",
  },
  {
    title: "Limits",
    body:
      "To the maximum extent allowed by law, CasterCycle and its operators disclaim warranties and liability for indirect, incidental, special, consequential, exemplary, lost-profit, lost-data, transaction, wallet, tax, safety, purchase, product, or third-party damages arising from app use or inability to use the app.",
  },
];

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-[#071018] px-4 py-6 text-white">
      <div className="mx-auto max-w-2xl">
        <Link className="inline-flex min-h-9 items-center rounded-md border border-white/12 bg-white/8 px-3 text-xs font-black uppercase tracking-[0.08em] text-white/70" href="/">
          Back to CasterCycle
        </Link>
        <div className="mt-6 rounded-md border border-[#fbe764]/28 bg-[#fbe764]/10 p-4">
          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-[#fbe764]">terms and disclaimer</div>
          <h1 className="mt-2 text-3xl font-black tracking-normal text-white">CasterCycle Terms</h1>
          <p className="mt-2 text-sm font-semibold leading-6 text-white/62">
            Updated {UPDATED}. Short version: play hard, share scores, keep control of your wallet, verify products and laws yourself, and do not treat the app as advice or a guarantee.
          </p>
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
          These terms are a practical product disclaimer, not a substitute for attorney-drafted terms. If you launch paid passes or affiliate promos publicly, have counsel review the final flow and published rules.
        </div>
      </div>
    </main>
  );
}
