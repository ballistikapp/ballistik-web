import { EventEmitter } from "events";

export type TradeCompleteEvent = {
  tokenPublicKey: string;
  sessionId: string;
  signature?: string;
};

export type IngestionCompleteEvent = {
  tokenPublicKey: string;
  signatureCount: number;
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

  emitIngestionComplete(event: IngestionCompleteEvent) {
    this.emit("ingestionComplete", event);
  }

  onIngestionComplete(listener: (event: IngestionCompleteEvent) => void): () => void {
    this.on("ingestionComplete", listener);
    return () => {
      this.removeListener("ingestionComplete", listener);
    };
  }
}

export const dashboardEvents = new DashboardEventEmitter();
