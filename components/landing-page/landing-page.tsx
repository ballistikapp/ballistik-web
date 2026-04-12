"use client";

import Link from "next/link";
import Image from "next/image";
import { IconBrandTelegram, IconBrandX } from "@tabler/icons-react";
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
import {
  BALLISTIK_TELEGRAM_URL,
  BALLISTIK_X_URL,
} from "@/lib/config/external-links";
import {
  BRAND_WORDMARK_CLASSNAME,
  SITE_BRAND_NAME,
} from "@/lib/config/site.config";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { LANDING_FAQ_ITEMS } from "@/lib/config/landing-faq";

export function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground scroll-smooth">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-screen overflow-hidden">
        <Spotlight />
      </div>
      <header className="mx-auto flex w-full items-center justify-between p-6 md:px-12 py-8">
        <motion.p
          className={`text-2xl md:text-3xl font-bold text-foreground ${BRAND_WORDMARK_CLASSNAME}`}
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeInOut" }}
        >
          {SITE_BRAND_NAME}
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
                  Solana pump.fun launches with Jito bundles, volume bots, and
                  full wallet control. Free to start; Pro adds premium limits.
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
              alt="Ballistik dashboard preview"
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
            className="text-[2rem] md:text-[3rem] w-full text-center bg-clip-text text-transparent bg-linear-to-b from-neutral-50 to-neutral-400 bg-opacity-50"
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

        <section
          id="platforms"
          className="flex w-full flex-col items-center gap-10 px-4 py-20 md:px-6 md:py-28"
        >
          <motion.h2
            className="text-[2rem] md:text-[3rem] w-full text-center bg-clip-text text-transparent bg-linear-to-b from-neutral-50 to-neutral-400 bg-opacity-50"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.8, ease: "easeOut" }}
          >
            Launch across platforms.
          </motion.h2>

          <motion.p
            className="mx-auto max-w-2xl text-center text-lg text-neutral-500 -mt-4"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.8, ease: "easeOut", delay: 0.2 }}
          >
            Start on pump.fun today. SPL and EVM support is next.
          </motion.p>

          <motion.div
            className="relative mx-auto w-full max-w-4xl overflow-hidden rounded-2xl border border-neutral-700/80 bg-linear-to-b from-neutral-900/80 to-black"
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.8, ease: "easeOut", delay: 0.35 }}
          >
            <div className="pointer-events-none absolute inset-0 rounded-2xl bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.06),transparent_40%),radial-gradient(circle_at_bottom_right,rgba(255,255,255,0.04),transparent_35%)]" />

            <div className="relative grid grid-cols-1 divide-y divide-neutral-800/80 md:grid-cols-3 md:divide-x md:divide-y-0">
              <div className="flex flex-col items-center gap-5 px-8 py-14">
                <Image
                  src="/logos/pumpfun.svg"
                  alt="pump.fun"
                  width={56}
                  height={56}
                  className="size-14"
                />
                <p className="text-lg font-semibold text-neutral-100">
                  pump.fun
                </p>
              </div>

              <div className="relative flex flex-col items-center px-8 py-14">
                <div className="flex flex-col items-center gap-5 opacity-[0.15]">
                  <Image
                    src="/logos/solana.svg"
                    alt="Solana"
                    width={56}
                    height={56}
                    className="size-14"
                  />
                  <p className="text-lg font-semibold text-neutral-100">SPL</p>
                </div>
                <span className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-full border border-neutral-600 bg-neutral-800 px-3 py-0.5 text-xs font-medium text-neutral-300">
                  Coming soon
                </span>
              </div>

              <div className="relative flex flex-col items-center px-8 py-14">
                <div className="flex flex-col items-center gap-5 opacity-[0.15]">
                  <Image
                    src="/logos/ethereum.svg"
                    alt="Ethereum"
                    width={56}
                    height={56}
                    className="size-14"
                  />
                  <p className="text-lg font-semibold text-neutral-100">EVM</p>
                </div>
                <span className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-full border border-neutral-600 bg-neutral-800 px-3 py-0.5 text-xs font-medium text-neutral-300">
                  Coming soon
                </span>
              </div>
            </div>
          </motion.div>
        </section>

        <section
          id="pricing"
          className="flex flex-col gap-10 w-full py-20 md:py-32 px-4 md:px-6"
        >
          <motion.h2
            className="text-[2rem] md:text-[3rem] w-full text-center bg-clip-text text-transparent bg-linear-to-b from-neutral-50 to-neutral-400 bg-opacity-50"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.8, ease: "easeOut" }}
          >
            Simple pricing. Clear access.
          </motion.h2>
          <motion.p
            className="text-center text-neutral-500 text-lg -mt-4"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.8, ease: "easeOut", delay: 0.2 }}
          >
            Start free, upgrade to Developer for lower fees and creator rewards,
            or go Pro for live features and zero platform fees on supported
            flows.
          </motion.p>
          <div className="h-10" />
          <div className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            <motion.div
              className="flex flex-col gap-6 rounded-2xl border border-neutral-800 bg-neutral-950/60 p-8"
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 0.8, ease: "easeOut", delay: 0.4 }}
            >
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-neutral-500 mb-2">
                  Free
                </p>
                <p className="text-4xl font-semibold text-neutral-100">Free</p>
                <p className="text-sm text-neutral-500 mt-1">
                  Pay platform fees only when you use supported tools
                </p>
              </div>
              <div className="h-px bg-neutral-800" />
              <div className="flex flex-col gap-3">
                {[
                  "Launch and manage tokens with pay-as-you-go platform fees",
                  "Dashboard monitoring falls back to polling",
                  "Volume bot stays available with slower minimum intervals",
                ].map((feature) => (
                  <div
                    key={feature}
                    className="flex items-start gap-3 text-sm"
                  >
                    <span className="mt-1 size-1.5 shrink-0 rounded-full bg-neutral-600" />
                    <span className="text-neutral-400">{feature}</span>
                  </div>
                ))}
              </div>
              <div className="mt-auto pt-2">
                <Link
                  href="/launch?preset=free"
                  className="inline-flex items-center gap-2 text-sm text-neutral-300 transition-colors hover:text-white"
                >
                  <span>Start for free</span>
                  <ChevronRightIcon className="h-4 w-4" />
                </Link>
              </div>
            </motion.div>

            <motion.div
              className="flex flex-col gap-6 rounded-2xl border border-neutral-700 bg-linear-to-b from-neutral-900/70 to-black p-8"
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 0.8, ease: "easeOut", delay: 0.55 }}
            >
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-neutral-500">
                  Developer
                </p>
                <div className="flex items-end gap-1.5">
                  <p className="text-4xl font-semibold text-neutral-100">
                    1.95 SOL
                  </p>
                  <p className="mb-1 text-neutral-500">/week</p>
                </div>
                <p className="mt-1 text-sm text-neutral-500">
                  Lower fees and creator-reward-eligible launch setup for active
                  builders
                </p>
              </div>
              <div className="h-px bg-neutral-800" />
              <div className="flex flex-col gap-3">
                {[
                  "Choose your dev wallet at launch so creator rewards can be claimed easily in the app on wallets you own",
                  "Get 25% off platform fees on supported launch and volume-bot flows",
                  "Manual renewal only, with no auto-renewal",
                ].map((feature) => (
                  <div
                    key={feature}
                    className="flex items-start gap-2.5 text-sm"
                  >
                    <span className="mt-1 size-1.5 shrink-0 rounded-full bg-neutral-200" />
                    <span className="text-neutral-300">{feature}</span>
                  </div>
                ))}
              </div>
              <div className="mt-auto pt-2">
                <Link
                  href="/auth"
                  className="inline-flex items-center gap-2 text-sm text-neutral-300 transition-colors hover:text-white"
                >
                  <span>Get Developer in the App</span>
                  <ChevronRightIcon className="h-4 w-4" />
                </Link>
              </div>
            </motion.div>

            <motion.div
              className="relative flex flex-col gap-6 rounded-2xl border border-neutral-700 bg-linear-to-b from-neutral-900/80 to-black p-8"
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 0.8, ease: "easeOut", delay: 0.7 }}
            >
              <div className="absolute -top-3 left-1/2 z-10 -translate-x-1/2">
                <span className="rounded-full border border-neutral-600 bg-neutral-800 px-3 py-0.5 text-xs font-medium text-neutral-300">
                  Pro Plan
                </span>
              </div>
              <div className="pointer-events-none absolute inset-0 rounded-2xl bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.14),transparent_35%),radial-gradient(circle_at_bottom_right,rgba(255,255,255,0.08),transparent_32%)]" />
              <div className="relative">
                <p className="text-xs font-semibold uppercase tracking-widest text-neutral-500 mb-2">
                  Pro
                </p>
                <div className="flex items-end gap-1.5">
                  <p className="text-4xl font-semibold text-neutral-100">4.95 SOL</p>
                  <p className="text-neutral-500 mb-1">/week</p>
                </div>
                <p className="text-sm text-neutral-500 mt-1">
                  Account-wide access with cleaner execution for active users
                </p>
              </div>
              <div className="relative h-px bg-neutral-800" />
              <div className="relative flex flex-col gap-3">
                {[
                  "Unlock live dashboard monitoring",
                  "Enable faster gRPC-backed flows where supported",
                  "Remove platform fees on supported launch and volume-bot flows",
                  "Manual renewal only, with no auto-renewal",
                ].map((feature) => (
                  <div
                    key={feature}
                    className="flex items-start gap-2.5 text-sm"
                  >
                    <span className="mt-1 size-1.5 shrink-0 rounded-full bg-neutral-200" />
                    <span className="text-neutral-300">{feature}</span>
                  </div>
                ))}
              </div>
              <p className="relative text-sm text-neutral-500">
                Network, Jito, rent, and protocol costs still apply.
              </p>
              <div className="relative mt-auto pt-2">
                <HoverBorderGradient
                  as={Link}
                  href="/auth"
                  containerClassName="w-full rounded-lg"
                  className="w-full justify-center bg-background flex items-center gap-2 px-4 py-2 text-sm font-medium text-foreground"
                  highlight="radial-gradient(75% 181.15942028985506% at 50% 50%, hsl(0, 0%, 100%) 0%, rgba(255, 255, 255, 0) 100%)"
                >
                  Get Pro in the App
                  <ChevronRightIcon className="h-4 w-4" />
                </HoverBorderGradient>
              </div>
            </motion.div>
          </div>
          <motion.p
            className="mx-auto max-w-3xl text-center text-sm text-neutral-600"
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.8, ease: "easeOut", delay: 0.7 }}
          >
            Free stays available for pay-as-you-go usage, Developer lowers
            platform fees and makes creator rewards easy to claim in the app on
            wallets you own, and Pro adds faster live features with zero
            platform fees on supported flows.
          </motion.p>
        </section>

        <section
          id="faq"
          className="flex flex-col gap-10 w-full py-20 md:py-32 px-4 md:px-6"
        >
          <motion.h2
            className="text-[2rem] md:text-[3rem] w-full text-center bg-clip-text text-transparent bg-linear-to-b from-neutral-50 to-neutral-400 bg-opacity-50"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.8, ease: "easeOut" }}
          >
            Common questions.
          </motion.h2>
          <motion.p
            className="text-center text-neutral-500 text-lg -mt-4"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.8, ease: "easeOut", delay: 0.2 }}
          >
            Straight answers about plans, fees, and how {SITE_BRAND_NAME}{" "}
            works.
          </motion.p>
          <div className="h-10" />
          <motion.div
            className="mx-auto w-full max-w-3xl overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-950/60"
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.8, ease: "easeOut", delay: 0.35 }}
          >
            <Accordion
              type="single"
              collapsible
              defaultValue="faq-0"
              className="w-full"
            >
              {LANDING_FAQ_ITEMS.map((item, index) => (
                <AccordionItem
                  key={item.question}
                  value={`faq-${index}`}
                  className="border-neutral-800/80 px-0"
                >
                  <AccordionTrigger className="gap-3 px-6 py-5 text-left text-lg font-semibold text-neutral-100 hover:no-underline md:px-8 md:py-6 **:data-[slot=accordion-trigger-icon]:text-neutral-500">
                    {item.question}
                  </AccordionTrigger>
                  <AccordionContent className="px-6 text-neutral-400 md:px-8">
                    <p className="pb-5 text-sm leading-relaxed md:pb-6">
                      {item.answer}
                    </p>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </motion.div>
        </section>
      </main>

      <footer className="mt-20 border-t border-neutral-800 px-6 md:px-12 py-20 ">
        <div className="flex flex-col items-center gap-4 md:grid md:grid-cols-[1fr_auto_1fr] md:items-center">
          <p
            className={`text-2xl font-bold text-foreground md:justify-self-start ${BRAND_WORDMARK_CLASSNAME}`}
          >
            {SITE_BRAND_NAME}
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
              href="#faq"
              className="hover:text-neutral-300 transition-colors"
            >
              FAQ
            </Link>
            <Link
              href="/auth"
              className="inline-flex items-center gap-1 hover:text-neutral-300 transition-colors"
            >
              <span>App</span>
              <ArrowRightIcon className="size-3.5" />
            </Link>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-4 text-xs text-neutral-500 md:justify-self-end md:gap-6">
            <Link
              href={BALLISTIK_TELEGRAM_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-1 hover:text-neutral-300 transition-colors"
            >
              <IconBrandTelegram className="size-3.5" />
              <span>Telegram</span>
              <ArrowUpRightIcon className="size-3.5" />
            </Link>
            <Link
              href={BALLISTIK_X_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-1 hover:text-neutral-300 transition-colors"
            >
              <IconBrandX className="size-3.5" />
              <span>X</span>
              <ArrowUpRightIcon className="size-3.5" />
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
