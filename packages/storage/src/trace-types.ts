export interface TraceEvent {
  readonly schemaVersion: "0.1";
  readonly eventId: string;
  readonly traceId: string;
  readonly spanId?: string;
  readonly parentSpanId?: string;
  readonly linkedTraceIds?: readonly string[];
  readonly timestamp: string;
  readonly eventType: string;
  readonly actor: Readonly<Record<string, unknown>> & {
    readonly type: string;
    readonly id: string;
  };
  readonly outcome: string;
  readonly references: Readonly<Record<string, unknown>> & {
    readonly capsuleId?: string;
    readonly capsuleVersion?: string;
    readonly knowledgeItemId?: string;
  };
  readonly metrics?: Readonly<Record<string, unknown>>;
  readonly error?: Readonly<Record<string, unknown>>;
  readonly attributes: Readonly<Record<string, unknown>>;
}

export type AppendTraceEventResult = "appended" | "duplicate";

export interface TraceCounts {
  readonly matched: number;
  readonly delivered: number;
  readonly fetched: number;
  readonly cited: number;
  readonly feedbackRecorded: number;
  readonly errors: number;
}

export interface ItemUsageCounts {
  readonly delivered: number;
  readonly fetched: number;
  readonly cited: number;
}

export interface TraceRepository {
  appendTraceEvent(event: TraceEvent): AppendTraceEventResult;
  listTraceEvents(traceId: string, limit?: number, offset?: number): readonly TraceEvent[];
  traceCounts(traceId: string): TraceCounts;
  itemUsage(capsuleId: string, version: string, itemId: string): ItemUsageCounts;
}
