"use client";

import Link from "next/link";
import Image from "next/image";
import { IconBrandTelegram } from "@tabler/icons-react";
import { motion } from "motion/react";
import {
  ArrowRightIcon,
  ArrowUpRightIcon,
  ChevronRightIcon,
} from "lucide-react";
import { Spotlight } from "@/components/ui/spotlight";
import { ContainerScroll } from "@/components/ui/container-scroll-animation";
import { HoverBorderGradient } from "@/components/ui/hover-border-gradient";
import FeaturesGrid from "@/components/landing-page/features-grid";
import { BALLISTIK_TELEGRAM_URL } from "@/lib/config/external-links";

export function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground scroll-smooth">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-screen overflow-hidden">
        <Spotlight />
      </div>
      <header className="mx-auto flex w-full items-center justify-between p-6 md:px-12 py-8">
        <motion.p
          className="text-2xl md:text-3xl font-bold text-foreground"
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeInOut" }}
        >
          BALLISTIK
        </motion.p>
        <motion.div
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeInOut", delay: 0.15 }}
        >
          <Link
            href="/auth"
            className="bg-black/30 hover:bg-black/60 transition-all duration-300 rounded-lg border-2 border-white/10 hover:border-white/30 flex items-center gap-4 md:gap-8 px-2.5 py-1.5 font-medium text-foreground"
          >
            <span>GO TO DAPP</span>
            <ChevronRightIcon className="h-5 w-5" />
          </Link>
        </motion.div>
      </header>

      <main className="flex flex-col items-center justify-center gap-20 pt-6">
        <section
          id="hero"
          className="relative w-full flex flex-col items-center"
        >
          <ContainerScroll
            cardAnimationDelay={1.5}
            titleComponent={
              <div className="flex flex-col items-center gap-2">
                <motion.h1
                  className="text-[3rem] sm:text-[3rem] md:text-[4rem] flex flex-col sm:flex-row font-medium items-center justify-center gap-1 sm:gap-6 bg-clip-text text-transparent bg-linear-to-b from-neutral-50 to-neutral-400 bg-opacity-50 leading-tight"
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 1.5, ease: "easeInOut", delay: 0.5 }}
                >
                  <span>Launch,</span>
                  <span>Automate,</span>
                  <span>Grow.</span>
                </motion.h1>
                <motion.p
                  className="text-neutral-500 text-sm sm:text-lg md:text-xl text-center px-4"
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 1.2, ease: "easeInOut", delay: 0.9 }}
                >
                  Jito-powered token launch, automated volume bots, and full
                  wallet control.
                </motion.p>
                <motion.div
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 1, ease: "easeInOut", delay: 1.1 }}
                  className="mt-12"
                >
                  <HoverBorderGradient
                    as={Link}
                    href="/launch?preset=free"
                    containerClassName="group rounded-lg"
                    className="bg-background flex items-center gap-5 px-4 py-2 text-lg md:text-xl font-medium text-foreground"
                    highlight="radial-gradient(75% 181.15942028985506% at 50% 50%, hsl(0, 0%, 100%) 0%, rgba(255, 255, 255, 0) 100%)"
                  >
                    <span>Launch Your Token for Free</span>
                    <ChevronRightIcon className="h-6 w-6" />
                  </HoverBorderGradient>
                </motion.div>
              </div>
            }
          >
            <Image
              src="/ballistik-dashboard.png"
              alt="hero"
              height={720}
              width={1400}
              className="block w-full h-auto"
              draggable={false}
            />
          </ContainerScroll>
        </section>

        <div className="h-16 md:h-40" />

        <section
          id="features"
          className="flex flex-col gap-10 w-full py-20 md:py-40 px-4 md:px-6"
        >
          <motion.h2
            className="text-[2rem] md:text-[3rem] w-full text-center bg-clip-text text-transparent bg-gradient-to-b from-neutral-50 to-neutral-400 bg-opacity-50"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.8, ease: "easeOut" }}
          >
            Everything you need to grow your token.
          </motion.h2>

          <motion.p
            className="text-center text-neutral-500 text-lg -mt-4"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.8, ease: "easeOut", delay: 0.2 }}
          >
            No fragmented tools. No manual steps. Just clean on-chain execution.
          </motion.p>
          <div className="h-10" />
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.9, ease: "easeOut", delay: 0.4 }}
          >
            <FeaturesGrid />
          </motion.div>
        </section>

        {/* <section
          id="pricing"
          className="flex flex-col gap-10 w-full py-40 px-6 max-w-6xl mx-auto"
        >
          <motion.h2
            className="text-[3rem] w-full text-center bg-clip-text text-transparent bg-gradient-to-b from-neutral-50 to-neutral-400 bg-opacity-50"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.8, ease: "easeOut" }}
          >
            Only pay for what you use. Or less.
          </motion.h2>
          <motion.p
            className="text-center text-neutral-500 text-lg -mt-4"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.8, ease: "easeOut", delay: 0.2 }}
          >
            No subscriptions required. Pay per action, or save with a plan.
          </motion.p>
          <div className="h-10" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <motion.div
              className="flex flex-col gap-6 rounded-2xl border border-neutral-800 bg-neutral-950/60 p-8"
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 0.8, ease: "easeOut", delay: 0.4 }}
            >
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-neutral-500 mb-2">
                  Pay As You Go
                </p>
                <p className="text-4xl font-semibold text-neutral-100">Free</p>
                <p className="text-sm text-neutral-500 mt-1">
                  No monthly commitment
                </p>
              </div>
              <div className="h-px bg-neutral-800" />
              <div className="flex flex-col gap-3">
                <p className="text-xs font-semibold uppercase tracking-widest text-neutral-500 mb-1">
                  Fee Schedule
                </p>
                {[
                  ["Token Launch", "0.05 SOL"],
                  ["Liquidity Pool Creation", "0.02 SOL"],
                  ["Metadata Update", "0.005 SOL"],
                  ["Freeze / Revoke Authority", "0.005 SOL"],
                  ["Airdrop (per 100 wallets)", "0.01 SOL"],
                  ["Custom Vanity Address", "0.02 SOL"],
                ].map(([label, fee]) => (
                  <div
                    key={label}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="text-neutral-400">{label}</span>
                    <span className="text-neutral-200 font-medium tabular-nums">
                      {fee}
                    </span>
                  </div>
                ))}
              </div>
            </motion.div>

            <motion.div
              className="relative flex flex-col gap-6 rounded-2xl border border-neutral-700 bg-neutral-900/60 p-8"
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 0.8, ease: "easeOut", delay: 0.55 }}
            >
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <span className="rounded-full border border-neutral-600 bg-neutral-800 px-3 py-0.5 text-xs font-medium text-neutral-300">
                  Most Popular
                </span>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-neutral-500 mb-2">
                  Pro
                </p>
                <div className="flex items-end gap-1.5">
                  <p className="text-4xl font-semibold text-neutral-100">$29</p>
                  <p className="text-neutral-500 mb-1">/month</p>
                </div>
                <p className="text-sm text-neutral-500 mt-1">
                  For active launchers
                </p>
              </div>
              <div className="h-px bg-neutral-800" />
              <div className="flex flex-col gap-3">
                {[
                  "10 token launches / month",
                  "Unlimited metadata updates",
                  "Priority RPC access",
                  "Liquidity pool automation",
                  "Airdrop tool (up to 500 wallets)",
                  "Email support",
                ].map((feature) => (
                  <div
                    key={feature}
                    className="flex items-start gap-2.5 text-sm"
                  >
                    <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400" />
                    <span className="text-neutral-300">{feature}</span>
                  </div>
                ))}
              </div>
              <div className="mt-auto pt-2">
                <HoverBorderGradient
                  as={Link}
                  href="/auth"
                  containerClassName="w-full rounded-lg"
                  className="w-full justify-center bg-background flex items-center gap-2 px-4 py-2 text-sm font-medium text-foreground"
                  highlight="radial-gradient(75% 181.15942028985506% at 50% 50%, hsl(0, 0%, 100%) 0%, rgba(255, 255, 255, 0) 100%)"
                >
                  Get Started
                  <ChevronRightIcon className="h-4 w-4" />
                </HoverBorderGradient>
              </div>
            </motion.div>

            <motion.div
              className="flex flex-col gap-6 rounded-2xl border border-neutral-800 bg-neutral-950/60 p-8"
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 0.8, ease: "easeOut", delay: 0.7 }}
            >
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-neutral-500 mb-2">
                  Scale
                </p>
                <div className="flex items-end gap-1.5">
                  <p className="text-4xl font-semibold text-neutral-100">$99</p>
                  <p className="text-neutral-500 mb-1">/month</p>
                </div>
                <p className="text-sm text-neutral-500 mt-1">
                  For teams and high-volume ops
                </p>
              </div>
              <div className="h-px bg-neutral-800" />
              <div className="flex flex-col gap-3">
                {[
                  "Unlimited token launches",
                  "Unlimited metadata updates",
                  "Dedicated RPC node",
                  "Liquidity pool automation",
                  "Airdrop tool (unlimited wallets)",
                  "Multi-wallet management",
                  "Priority support + SLA",
                ].map((feature) => (
                  <div
                    key={feature}
                    className="flex items-start gap-2.5 text-sm"
                  >
                    <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400" />
                    <span className="text-neutral-300">{feature}</span>
                  </div>
                ))}
              </div>
              <div className="mt-auto pt-2">
                <HoverBorderGradient
                  as={Link}
                  href="/auth"
                  containerClassName="w-full rounded-lg"
                  className="w-full justify-center bg-background flex items-center gap-2 px-4 py-2 text-sm font-medium text-foreground"
                  highlight="radial-gradient(75% 181.15942028985506% at 50% 50%, hsl(0, 0%, 100%) 0%, rgba(255, 255, 255, 0) 100%)"
                >
                  Get Started
                  <ChevronRightIcon className="h-4 w-4" />
                </HoverBorderGradient>
              </div>
            </motion.div>
          </div>
        </section> */}
      </main>

      <footer className="mt-20 border-t border-neutral-800 px-6 md:px-12 py-20 ">
        <div className="flex flex-col items-center gap-4 md:grid md:grid-cols-[1fr_auto_1fr] md:items-center">
          <p className="text-2xl font-bold text-foreground tracking-wide md:justify-self-start">
            BALLISTIK
          </p>
          <div className="flex items-center justify-center gap-6 text-xs text-neutral-500 md:justify-self-center">
            <Link
              href="#features"
              className="hover:text-neutral-300 transition-colors"
            >
              Features
            </Link>
            <Link
              href="#pricing"
              className="hover:text-neutral-300 transition-colors"
            >
              Pricing
            </Link>
            <Link
              href="/auth"
              className="inline-flex items-center gap-1 hover:text-neutral-300 transition-colors"
            >
              <span>App</span>
              <ArrowRightIcon className="size-3.5" />
            </Link>
          </div>
          <Link
            href={BALLISTIK_TELEGRAM_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-1 text-xs text-neutral-500 hover:text-neutral-300 transition-colors md:justify-self-end"
          >
            <IconBrandTelegram className="size-3.5" />
            <span>Telegram</span>
            <ArrowUpRightIcon className="size-3.5" />
          </Link>
        </div>
      </footer>
    </div>
  );
}
