import { EventEmitter } from "events";

export type TradeCompleteEvent = {
  tokenPublicKey: string;
  sessionId: string;
};

class DashboardEventEmitter extends EventEmitter {
  emitTradeComplete(event: TradeCompleteEvent) {
    this.emit("tradeComplete", event);
  }

  onTradeComplete(listener: (event: TradeCompleteEvent) => void): () => void {
    this.on("tradeComplete", listener);
    return () => {
      this.removeListener("tradeComplete", listener);
    };
  }
}

export const dashboardEvents = new DashboardEventEmitter();
