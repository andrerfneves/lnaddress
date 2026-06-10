import {
  type PayRequest,
  type PaymentInstruction,
  type RequestPaymentOptions,
  type VerifyResult,
  pay,
  request_payment,
  resolve,
  validate_callback_amount,
  validate_comment,
  validate_mandatory_payer_data,
  verify_payment,
} from "lnaddress";
import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Tabs } from "./components/ui/tabs";
import { Textarea } from "./components/ui/textarea";
import { create_playground_fetch } from "./lib/mock-provider";
import "./styles.css";

type Scenario = "bolt11" | "destination";

const scenarios: Record<Scenario, { label: string; input: string; amount_msat: number }> = {
  bolt11: {
    label: "BOLT11 invoice",
    input: "alice@playground.lnaddress.test",
    amount_msat: 25_000,
  },
  destination: {
    label: "Destination rail",
    input: "liquid@playground.lnaddress.test",
    amount_msat: 10_000,
  },
};

function stringify(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, inner_value) => (typeof inner_value === "bigint" ? inner_value.toString() : inner_value),
    2,
  );
}

function JsonPanel({ label, value }: { label: string; value: unknown }) {
  return (
    <section className="json-panel">
      <div className="panel-heading">{label}</div>
      <pre>{value ? stringify(value) : "null"}</pre>
    </section>
  );
}

function StatusLine({
  label,
  state,
}: {
  label: string;
  state: "idle" | "valid" | "error";
}) {
  const tone = state === "valid" ? "success" : state === "error" ? "danger" : "neutral";
  return (
    <div className="status-line">
      <span>{label}</span>
      <Badge tone={tone}>{state}</Badge>
    </div>
  );
}

function App() {
  const [scenario, set_scenario] = useState<Scenario>("bolt11");
  const [input, set_input] = useState(scenarios.bolt11.input);
  const [amount_msat, set_amount_msat] = useState(String(scenarios.bolt11.amount_msat));
  const [comment, set_comment] = useState("Thanks from the playground");
  const [payer_name, set_payer_name] = useState("Alice");
  const [payer_email, set_payer_email] = useState("alice@example.com");
  const [pay_request, set_pay_request] = useState<PayRequest | null>(null);
  const [payment, set_payment] = useState<PaymentInstruction | null>(null);
  const [verify_result, set_verify_result] = useState<VerifyResult | null>(null);
  const [error, set_error] = useState<string | null>(null);
  const fetch = useMemo(() => create_playground_fetch(), []);

  const payer_data = useMemo(
    () => ({
      name: payer_name,
      email: payer_email,
    }),
    [payer_name, payer_email],
  );

  const validation = useMemo(() => {
    if (!pay_request) {
      return {
        amount: "idle",
        comment: "idle",
        payer_data: "idle",
      } as const;
    }

    return {
      amount: safe_validate(() => validate_callback_amount(pay_request, Number(amount_msat))),
      comment: safe_validate(() => validate_comment(pay_request, comment || undefined)),
      payer_data: safe_validate(() => validate_mandatory_payer_data(pay_request, payer_data)),
    } as const;
  }, [amount_msat, comment, pay_request, payer_data]);

  function select_scenario(next: Scenario) {
    set_scenario(next);
    set_input(scenarios[next].input);
    set_amount_msat(String(scenarios[next].amount_msat));
    set_pay_request(null);
    set_payment(null);
    set_verify_result(null);
    set_error(null);
  }

  async function run_resolve() {
    set_error(null);
    set_payment(null);
    set_verify_result(null);

    try {
      const resolved = await resolve(input, { fetch });
      set_pay_request(resolved);
    } catch (cause) {
      set_error(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function run_request() {
    set_error(null);
    set_verify_result(null);

    try {
      const request_options = build_request_options();
      const instruction = pay_request
        ? await request_payment(pay_request, request_options)
        : await pay(input, request_options);

      set_payment(instruction);
    } catch (cause) {
      set_error(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function build_request_options(): RequestPaymentOptions {
    const options: RequestPaymentOptions = {
      amount_msat: Number(amount_msat),
      payer_data,
      fetch,
    };

    if (comment) {
      options.comment = comment;
    }

    return options;
  }

  async function run_verify() {
    if (!payment) {
      set_error("Request a payment instruction first");
      return;
    }

    set_error(null);

    try {
      const verified = await verify_payment(payment, { fetch });
      set_verify_result(verified);
    } catch (cause) {
      set_error(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <main className="shell">
      <section className="workspace">
        <header className="masthead">
          <div>
            <p className="eyebrow">lnaddress playground</p>
            <h1>Exercise the client from resolve to verify.</h1>
          </div>
          <Badge tone={payment?.type === "bolt11" ? "success" : payment ? "warning" : "neutral"}>
            {payment?.type ?? "ready"}
          </Badge>
        </header>

        <Tabs
          on_change={select_scenario}
          options={[
            { value: "bolt11", label: scenarios.bolt11.label },
            { value: "destination", label: scenarios.destination.label },
          ]}
          value={scenario}
        />

        <section className="control-grid">
          <div className="control-panel">
            <label htmlFor="lnaddress-input">
              Address, LNURL, or URL
              <Input
                id="lnaddress-input"
                value={input}
                onChange={(event) => set_input(event.target.value)}
              />
            </label>

            <div className="field-row">
              <label htmlFor="amount-msat-input">
                Amount msat
                <Input
                  id="amount-msat-input"
                  inputMode="numeric"
                  value={amount_msat}
                  onChange={(event) => set_amount_msat(event.target.value)}
                />
              </label>
              <label htmlFor="payer-name-input">
                Name
                <Input
                  id="payer-name-input"
                  value={payer_name}
                  onChange={(event) => set_payer_name(event.target.value)}
                />
              </label>
            </div>

            <label htmlFor="payer-email-input">
              Email
              <Input
                id="payer-email-input"
                value={payer_email}
                onChange={(event) => set_payer_email(event.target.value)}
              />
            </label>

            <label htmlFor="comment-input">
              Comment
              <Textarea
                id="comment-input"
                value={comment}
                onChange={(event) => set_comment(event.target.value)}
              />
            </label>

            <div className="button-row">
              <Button onClick={run_resolve}>Resolve</Button>
              <Button onClick={run_request} variant="secondary">
                Request
              </Button>
              <Button onClick={run_verify} variant="ghost">
                Verify
              </Button>
            </div>
          </div>

          <aside className="validation-panel">
            <div className="panel-heading">Validation</div>
            <StatusLine label="Amount" state={validation.amount} />
            <StatusLine label="Comment" state={validation.comment} />
            <StatusLine label="Payer data" state={validation.payer_data} />
            {error ? <div className="error-strip">{error}</div> : null}
          </aside>
        </section>

        <section className="result-grid">
          <JsonPanel label="PayRequest" value={pay_request} />
          <JsonPanel label="PaymentInstruction" value={payment} />
          <JsonPanel label="VerifyResult" value={verify_result} />
        </section>
      </section>
    </main>
  );
}

function safe_validate(fn: () => void): "valid" | "error" {
  try {
    fn();
    return "valid";
  } catch {
    return "error";
  }
}

const root = document.getElementById("root");

if (!root) {
  throw new Error("Missing root element");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
