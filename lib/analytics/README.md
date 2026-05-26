# Analytics Integration

## Clicky Analytics

Clicky is integrated into ballistik-web for privacy-focused web analytics.

### Setup

1. Environment variable is configured: `NEXT_PUBLIC_CLICKY_SITE_ID=101500626`
2. Tracking script loads automatically on all pages via root layout
3. Real-time analytics available at: https://clicky.com/101500626

### Custom Event Tracking

Use the `clickyTracker` utility to track custom events in your components:

```tsx
import { clickyTracker } from "@/lib/analytics/clicky";

// Track a goal/event
clickyTracker.trackGoal("token-launch");

// Track with revenue (in your currency)
clickyTracker.trackGoal("token-purchase", 0.5);

// Track custom page view
clickyTracker.trackPageView("/custom-route", "Custom Page Title");
```

### Common Use Cases

#### Token Launch

```tsx
"use client";

import { clickyTracker } from "@/lib/analytics/clicky";

export function LaunchButton() {
  const handleLaunch = async () => {
    // Your launch logic...

    // Track the event
    clickyTracker.trackGoal("token-launch");
  };

  return <button onClick={handleLaunch}>Launch Token</button>;
}
```

#### Wallet Creation

```tsx
const handleCreateWallet = async () => {
  const wallet = await createWallet();

  // Track wallet creation
  clickyTracker.trackGoal("wallet-created");

  return wallet;
};
```

#### Transaction Tracking

```tsx
const handleTransaction = async (amount: number) => {
  const result = await executeTransaction();

  // Track with transaction value
  clickyTracker.trackGoal("transaction-completed", amount);
};
```

### Setting Up Goals in Clicky

1. Go to your Clicky dashboard: https://clicky.com/101500626
2. Navigate to Preferences → Goals
3. Create goals with exact names matching your trackGoal() calls
4. Examples: `token-launch`, `wallet-created`, `transaction-completed`

### Notes

- Tracking is automatic for pageviews - no code needed
- Custom events require goals to be set up in Clicky dashboard first
- All tracking is privacy-friendly (no cookies by default)
- Script loads after page interactive to not block rendering
