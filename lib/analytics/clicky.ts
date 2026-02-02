declare global {
  interface Window {
    clicky?: {
      log: (href: string, title?: string, type?: string) => void;
      goal: (name: string, revenue?: number) => void;
    };
  }
}

export const clickyTracker = {
  /**
   * Track a custom event/goal
   * @param name - Goal name (must be set up in Clicky dashboard)
   * @param revenue - Optional revenue amount
   */
  trackGoal(name: string, revenue?: number) {
    if (typeof window !== "undefined" && window.clicky) {
      window.clicky.goal(name, revenue);
    }
  },

  /**
   * Track a custom page view
   * @param href - Page URL
   * @param title - Page title
   */
  trackPageView(href: string, title?: string) {
    if (typeof window !== "undefined" && window.clicky) {
      window.clicky.log(href, title);
    }
  },
};
