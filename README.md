# ballistik-web

Web app for [Ballistik](https://ballistik.app) — Solana token launch, Jito bundles, volume bot, and operational wallets on pump.fun.

Built with [Next.js](https://nextjs.org) (App Router), tRPC, Prisma, and PostgreSQL.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deployment

This app is deployed on Railway using GitHub repository deployment for the Next.js service.

- `staging` branch deploys to Railway `staging`
- `main` branch deploys to Railway `production`
- Each environment has its own PostgreSQL database

For local development, `DATABASE_URL` currently points to the staging database.
