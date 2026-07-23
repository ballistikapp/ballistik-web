import {
  WEEKLY_DEVELOPER_PRICE_SOL,
  WEEKLY_PRO_PRICE_SOL,
} from "@/lib/config/subscription.config";
import { SITE_BRAND_NAME } from "@/lib/config/site.config";

export type LandingFaqItem = {
  question: string;
  answer: string;
};

/**
 * Homepage FAQ copy — single source for visible Q&A and FAQPage JSON-LD.
 * Keep answers aligned with landing and pricing sections.
 */
export const LANDING_FAQ_ITEMS: readonly LandingFaqItem[] = [
  {
    question: "What is Ballistik?",
    answer: `${SITE_BRAND_NAME} is a web app for launching and operating Solana tokens on pump.fun. It brings together launches, Jito bundles, operational wallets, a volume bot, and dashboard monitoring so you can run a token from one place instead of juggling separate tools.`,
  },
  {
    question: "Does Ballistik support pump.fun launches?",
    answer: `Yes. You can launch and manage pump.fun tokens in ${SITE_BRAND_NAME} today. SPL and EVM support is planned; check the landing page for the latest roadmap.`,
  },
  {
    question: "Is there a Pro plan?",
    answer: `Yes. Pro is a weekly subscription (${WEEKLY_PRO_PRICE_SOL} SOL per week, manual renewal only) that unlocks live dashboard monitoring, faster gRPC-backed flows where supported, and removes platform fees on supported launch and volume-bot flows. Network, Jito, rent, and protocol costs still apply.`,
  },
  {
    question: "What are Free, Developer, and Pro?",
    answer: `Free lets you launch and manage tokens with pay-as-you-go platform fees when you use supported tools. Developer (${WEEKLY_DEVELOPER_PRICE_SOL} SOL per week, manual renewal) lowers platform fees on supported flows and helps you use a dev wallet you own for creator rewards. Pro (${WEEKLY_PRO_PRICE_SOL} SOL per week, manual renewal) adds premium limits, live monitoring, and zero platform fees on supported launch and volume-bot flows.`,
  },
  {
    question: "How do I sign in?",
    answer: `You sign in with your Solana wallet private key through the app. ${SITE_BRAND_NAME} issues a session after authentication so you can use the dashboard without resigning for every action.`,
  },
  {
    question: "What are Jito bundles and the volume bot?",
    answer: `Jito bundles group multiple Solana transactions so they can land together in the same block—useful for coordinated launches and exits. The volume bot automates trading sessions across operational wallets with configurable timing; availability and minimum intervals depend on your plan.`,
  },
  {
    question: "How do platform fees and subscriptions work?",
    answer: `On the Free tier you pay platform fees when you use supported launch and volume-bot flows. Developer and Pro subscriptions are billed in SOL per week with manual renewal only—no auto-renewal. Subscriptions change platform fee treatment and feature limits as described on the pricing section; they do not replace network or protocol charges.`,
  },
  {
    question: "Does a Pro subscription cover every on-chain cost?",
    answer: `No. Pro removes platform fees on supported launch and volume-bot flows. You still pay Solana network fees, Jito tips where used, account rent, and any third-party or protocol fees.`,
  },
  {
    question: "What is the Ballistik affiliate program?",
    answer: `The affiliate program lets approved Marketers earn a share of platform spend from Users they refer. Share rates are set by Operators and are not published here. Interested Users apply in the app after signing in.`,
  },
  {
    question: "How do I apply to the affiliate program?",
    answer: `Sign in to ${SITE_BRAND_NAME}, open Referrals, and submit a Marketer Application. Operators review Applications and designate Marketers.`,
  },
  {
    question: "How do Marketers earn from referrals?",
    answer: `Marketers earn a share of referred Users' platform payments (usage fees and subscriptions), sent to a fee-collector wallet the Marketer configures. Exact share rates stay Operator-owned and are not listed on this page.`,
  },
];
