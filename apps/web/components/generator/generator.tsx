"use client";

import { useCallback, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Sparkles } from "lucide-react";
import type {
  JobEvent,
  JobPhase,
  JobSummary,
  ParseResponse,
  SourceKind,
  ToolEdit,
} from "@/lib/protocol";
import { createJob, fetchFiles, parseSource, streamJob } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Stepper, type StepId } from "./stepper";
import { SourceStep, type KindChoice } from "./source-step";
import { ReviewPanel, type EditMap } from "./review-panel";
import { ConfigStep, type GenConfig } from "./config-step";
import { ProgressStream } from "./progress-stream";
import { ResultPanel } from "./result-panel";

const DEFAULT_CONFIG: GenConfig = {
  transport: "stdio",
  auth: "none",
  useAi: false,
  verify: false,
};

export function Generator() {
  const [step, setStep] = useState<StepId>("source");

  // Source
  const [source, setSource] = useState("");
  const [kind, setKind] = useState<KindChoice>("auto");
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string>();

  // Review
  const [parsed, setParsed] = useState<ParseResponse | null>(null);
  const [edits, setEdits] = useState<EditMap>({});

  // Configure
  const [config, setConfig] = useState<GenConfig>(DEFAULT_CONFIG);

  // Run
  const [jobId, setJobId] = useState<string | null>(null);
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [phase, setPhase] = useState<JobPhase>("queued");
  const [summary, setSummary] = useState<JobSummary | null>(null);
  const [files, setFiles] = useState<Record<string, string> | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const disposeRef = useRef<(() => void) | null>(null);

  const detect = useCallback(async () => {
    setParsing(true);
    setParseError(undefined);
    try {
      const result = await parseSource({
        source,
        kind: kind === "auto" ? undefined : (kind as SourceKind),
      });
      if (result.tools.length === 0) {
        setParseError("No operations were detected in this source.");
        return;
      }
      setParsed(result);
      const init: EditMap = {};
      for (const t of result.tools)
        init[t.name] = { name: t.name, enabled: true };
      setEdits(init);
      setStep("review");
    } catch (err) {
      setParseError((err as Error).message);
    } finally {
      setParsing(false);
    }
  }, [source, kind]);

  const generate = useCallback(async () => {
    setStep("result");
    setPhase("queued");
    setEvents([]);
    setSummary(null);
    setFiles(null);
    setRunError(null);

    const toolEdits: ToolEdit[] = Object.values(edits);
    try {
      const id = await createJob({
        source,
        kind: kind === "auto" ? undefined : (kind as SourceKind),
        transport: config.transport,
        auth: config.auth,
        useAi: config.useAi,
        verify: config.verify,
        tools: toolEdits,
      });
      setJobId(id);
      disposeRef.current = streamJob(
        id,
        (event) => {
          setEvents((prev) => [...prev, event]);
          if (event.type === "phase") setPhase(event.phase);
          if (event.type === "error") setRunError(event.message);
          if (event.type === "done") {
            setSummary(event.summary);
            fetchFiles(id)
              .then(setFiles)
              .catch((e) => setRunError((e as Error).message));
          }
        },
        (err) => setRunError(err.message),
      );
    } catch (err) {
      setRunError((err as Error).message);
      setPhase("error");
    }
  }, [edits, source, kind, config]);

  const reset = useCallback(() => {
    disposeRef.current?.();
    disposeRef.current = null;
    setStep("source");
    setParsed(null);
    setEdits({});
    setConfig(DEFAULT_CONFIG);
    setJobId(null);
    setEvents([]);
    setSummary(null);
    setFiles(null);
    setRunError(null);
    setPhase("queued");
  }, []);

  const enabledCount = parsed
    ? parsed.tools.filter((t) => edits[t.name]?.enabled !== false).length
    : 0;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-4 border-b border-[var(--color-line)] p-6 sm:flex-row sm:items-center sm:justify-between">
        <Stepper current={step} />
        <span className="eyebrow">no account · free</span>
      </div>

      <CardContent className="p-6">
        {step === "source" && (
          <SourceStep
            source={source}
            kind={kind}
            loading={parsing}
            error={parseError}
            onSourceChange={setSource}
            onKindChange={setKind}
            onSubmit={detect}
          />
        )}

        {step === "review" && parsed && (
          <div className="space-y-6">
            <ReviewPanel parsed={parsed} edits={edits} onChange={setEdits} />
            <div className="flex items-center justify-between">
              <Button variant="ghost" onClick={() => setStep("source")}>
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
              <Button
                onClick={() => setStep("configure")}
                disabled={enabledCount === 0}
                data-testid="to-configure"
              >
                Configure
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {step === "configure" && (
          <div className="space-y-6">
            <ConfigStep config={config} onChange={setConfig} />
            <div className="flex items-center justify-between">
              <Button variant="ghost" onClick={() => setStep("review")}>
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
              <Button onClick={generate} data-testid="generate-button">
                <Sparkles className="h-4 w-4" />
                Generate MCP server
              </Button>
            </div>
          </div>
        )}

        {step === "result" && (
          <div className="space-y-6">
            {runError ? (
              <div className="space-y-4" data-testid="run-error">
                <p
                  role="alert"
                  className="rounded-lg border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]"
                >
                  {runError}
                </p>
                <Button variant="secondary" onClick={reset}>
                  Start over
                </Button>
              </div>
            ) : summary && files ? (
              <ResultPanel
                jobId={jobId!}
                summary={summary}
                files={files}
                onReset={reset}
              />
            ) : (
              <ProgressStream events={events} phase={phase} />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
