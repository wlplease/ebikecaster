import Link from "next/link";

const UPDATED = "June 2, 2026";

const quickFacts = [
  ["Storage", "Local app state"],
  ["Profile", "Farcaster data"],
  ["Wallet", "Public address"],
  ["Social", "Scores + chat"],
  ["Analytics", "Usage signals"],
  ["Links", "Third parties"],
];

const sections = [
  {
    title: "What This Covers",
    body:
      "This Privacy page describes the practical data practices for CasterCycle, including the game, Fan tab, paid pass flow, scores, lounge, local storage, analytics, affiliate links, and Farcaster Mini App integrations.",
  },
  {
    title: "Local App Data",
    body:
      "CasterCycle stores some settings in your browser or Mini App environment, such as theme, audio, voice, selected bike skin, selected world, intro state, pass receipts, and ride stats. This helps the app remember your experience. Clearing local storage can remove some saved state.",
  },
  {
    title: "Farcaster Profile Data",
    body:
      "When available through Farcaster Mini App context, the app may display your Farcaster user id, username, display name, and profile image. This is used for the app UI, leaderboards, lounge messages, sharing, and score display.",
  },
  {
    title: "Wallet And Pass Data",
    body:
      "If you connect or use wallet actions, the app may process public wallet addresses, selected pass plan, transaction labels, timestamps, pass expiration, and transaction status. CasterCycle does not custody your funds or store private keys.",
  },
  {
    title: "Scores And Lounge",
    body:
      "If you submit scores or lounge messages, the app may store and show ride scores, route names, dates, leaderboard mode, profile display data, and short lounge text. Do not submit private, sensitive, illegal, unsafe, or third-party confidential information.",
  },
  {
    title: "Voice, Audio, And APIs",
    body:
      "The app may call server APIs for ride voice, scores, lounge, image sharing, and Mini App functions. Requests may include ordinary technical data such as timestamps, route parameters, rate-limit keys, browser metadata, and IP-derived request information needed to operate and protect the service.",
  },
  {
    title: "Analytics",
    body:
      "The app uses Vercel Analytics to understand basic app usage and performance. Analytics providers may process technical information under their own privacy practices.",
  },
  {
    title: "Affiliate And Third-Party Links",
    body:
      "Fan tab merchant links, video links, wallet tools, Farcaster actions, analytics, and affiliate/referral links can take you to third-party services. Those third parties may collect data under their own privacy policies and terms. CasterCycle does not control their practices.",
  },
  {
    title: "Cookies And Similar Storage",
    body:
      "CasterCycle may use browser storage, Mini App platform storage, wallet/session state, analytics technology, and third-party link tracking. The exact tools can change as the app evolves.",
  },
  {
    title: "Children",
    body:
      "CasterCycle is not intended for children under 13. Do not use the app or submit information if you are under 13. Parents or guardians who believe a child submitted personal information should contact the operator through the available site or platform contact path so the issue can be reviewed.",
  },
  {
    title: "Retention",
    body:
      "Local app data may remain until you clear it. Server-side scores, lounge entries, rate-limit records, and operational logs may be kept as needed for gameplay, moderation, abuse prevention, security, legal, and operational reasons.",
  },
  {
    title: "Security",
    body:
      "No app can guarantee perfect security. Use strong wallet hygiene, verify transaction prompts, avoid sharing private information, and do not rely on CasterCycle to secure third-party accounts, wallets, merchants, or devices.",
  },
  {
    title: "Your Choices",
    body:
      "You can avoid optional wallet actions, avoid posting lounge messages, avoid sharing scores, clear local storage, leave the Mini App, and use official merchant pages directly. Platform, browser, wallet, and third-party privacy controls may also apply.",
  },
  {
    title: "Changes",
    body:
      "This Privacy page may be updated as the app changes. Continued use after updates means you accept the updated practices.",
  },
];

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[#071018] px-4 py-6 text-white">
      <div className="mx-auto max-w-2xl">
        <div className="flex flex-wrap gap-2">
          <Link className="inline-flex min-h-9 items-center rounded-md border border-white/12 bg-white/8 px-3 text-xs font-black uppercase tracking-[0.08em] text-white/70" href="/">
            Back
          </Link>
          <Link className="inline-flex min-h-9 items-center rounded-md border border-[#fbe764]/25 bg-[#fbe764]/10 px-3 text-xs font-black uppercase tracking-[0.08em] text-[#fbe764]" href="/terms">
            Terms
          </Link>
        </div>

        <div className="mt-6 rounded-md border border-[#7cf2ff]/28 bg-[#7cf2ff]/10 p-4">
          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-[#7cf2ff]">privacy snapshot</div>
          <h1 className="mt-2 text-3xl font-black tracking-normal text-white">CasterCycle Privacy</h1>
          <p className="mt-2 text-sm font-semibold leading-6 text-white/62">
            Updated {UPDATED}. Short version: the app uses local storage, Farcaster context, wallet/pass data, scores, chat, analytics, and third-party links to run the experience.
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

        <div className="mt-4 rounded-md border border-[#ff5d73]/20 bg-[#ff5d73]/8 p-4 text-sm font-semibold leading-6 text-white/58">
          This is a practical privacy notice for the current app design, not legal advice. Review with qualified counsel before public launch, child-directed features, advertising expansion, or broader data collection.
        </div>
      </div>
    </main>
  );
}
