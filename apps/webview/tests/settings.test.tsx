// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import type { ProviderConfig } from "@comu/protocol";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SettingsView } from "../src/components/settings/SettingsView.js";
import { ProviderCard, formatCheckedAt } from "../src/components/settings/ProviderCard.js";

afterEach(() => cleanup());

const cloud: ProviderConfig = {
  providerId: "experiential",
  displayName: "GPT-6 Astra (Experiential Labs)",
  description: "Frontier reasoning and coding with a 1.05M token context window.",
  endpoint: "https://api.experientiallabs.ai/v1",
  enabled: true,
  hasCredential: false,
  isLocal: false,
  status: "NOT_CONFIGURED",
  models: [{ id: "gpt-6-astra", name: "GPT-6 Astra", contextTokens: 1_050_000 }]
};

const local: ProviderConfig = {
  providerId: "ollama",
  displayName: "Ollama (Local)",
  endpoint: "http://127.0.0.1:11434",
  enabled: true,
  hasCredential: true,
  isLocal: true,
  status: "CONNECTED",
  models: [{ id: "ollama:qwen2.5-coder", name: "Qwen 2.5 Coder (Local)", contextTokens: 8192 }]
};

function card(provider: ProviderConfig, over: Partial<React.ComponentProps<typeof ProviderCard>> = {}) {
  return render(
    <ProviderCard
      provider={provider}
      testing={false}
      onSave={() => {}}
      onRemove={() => {}}
      onTest={() => {}}
      {...over}
    />
  );
}

describe("ProviderCard", () => {
  it("names the provider and states its connection status in words", () => {
    card(cloud);
    expect(screen.getByRole("heading", { name: "GPT-6 Astra (Experiential Labs)" })).toBeTruthy();
    expect(screen.getByText("No key yet")).toBeTruthy();
    expect(screen.getByText("Cloud")).toBeTruthy();
  });

  it("distinguishes a rejected key from an unreachable endpoint", () => {
    const { rerender } = card({ ...cloud, status: "INVALID_CREDENTIAL" });
    expect(screen.getByText("Key rejected")).toBeTruthy();
    rerender(
      <ProviderCard
        provider={{ ...cloud, status: "CONNECTION_ERROR" }}
        testing={false}
        onSave={() => {}}
        onRemove={() => {}}
        onTest={() => {}}
      />
    );
    expect(screen.getByText("Unreachable")).toBeTruthy();
  });

  it("offers a key and endpoint for a cloud provider, and no key field for a local one", () => {
    const { unmount } = card(cloud);
    expect(screen.getByLabelText("API key")).toBeTruthy();
    expect(screen.getByLabelText("Endpoint")).toBeTruthy();
    unmount();

    card(local);
    expect(screen.queryByLabelText("API key")).toBeNull();
    expect(screen.getByText("No key needed")).toBeTruthy();
    const address = screen.getByLabelText("Daemon address") as HTMLInputElement;
    expect(address.value).toBe("http://127.0.0.1:11434");
    expect(address.readOnly).toBe(true);
  });

  it("masks the key and never echoes it as text anywhere in the card", () => {
    const { container } = card(cloud);
    const input = screen.getByLabelText("API key") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "sk-secret-value" } });

    // The field itself necessarily holds what was typed; what must never happen is the key
    // appearing as rendered text, in a status line, a label or the model list.
    expect(input.type).toBe("password");
    expect(container.textContent).not.toContain("sk-secret-value");
    expect(screen.queryByText(/sk-secret-value/)).toBeNull();
  });

  it("never renders a stored key back to the panel", () => {
    // The host reports only whether a credential exists, never its value.
    const { container } = card({ ...cloud, hasCredential: true, status: "CONNECTED" });
    const input = screen.getByLabelText("API key") as HTMLInputElement;
    expect(input.value).toBe("");
    expect(input.placeholder).toMatch(/A key is saved/);
    expect(container.textContent).not.toMatch(/sk-/);
  });

  it("cannot save an empty key, and saves the key with the endpoint", () => {
    const onSave = vi.fn();
    card(cloud, { onSave });
    const save = screen.getByRole("button", { name: /Save/ });
    expect(save.hasAttribute("disabled")).toBe(true);

    fireEvent.change(screen.getByLabelText("API key"), { target: { value: " sk-abc " } });
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));
    expect(onSave).toHaveBeenCalledWith("sk-abc", "https://api.experientiallabs.ai/v1");
  });

  it("offers Remove only when a key is actually stored", () => {
    const { unmount } = card(cloud);
    expect(screen.queryByRole("button", { name: /Remove key/ })).toBeNull();
    unmount();
    card({ ...cloud, hasCredential: true, status: "CONNECTED" });
    expect(screen.getByRole("button", { name: /Remove key/ })).toBeTruthy();
  });

  it("reports a test result, including why it failed", () => {
    const { unmount } = card(cloud, { testResult: { provider: "experiential", status: "CONNECTED", latencyMs: 240, model: "gpt-6-astra" } });
    expect(screen.getByRole("status").textContent).toContain("Reachable in 240ms");
    unmount();

    card(cloud, { testResult: { provider: "experiential", status: "CONNECTION_ERROR", message: "Could not reach the endpoint." } });
    expect(screen.getByRole("status").textContent).toContain("Could not reach the endpoint.");
  });

  it("never shows a saved key that nothing has probed as connected", () => {
    card({ ...cloud, hasCredential: true, status: "UNCHECKED" });
    expect(screen.getByText("Not checked")).toBeTruthy();
    expect(screen.queryByText("Connected")).toBeNull();
  });

  it("derives the badge and the result from the same probe, and says when it ran", () => {
    const checkedAt = new Date().toISOString();
    const { container } = card({
      ...cloud,
      hasCredential: true,
      status: "TIMEOUT",
      lastCheck: { provider: "experiential", status: "TIMEOUT", message: "Connection timed out after 15 seconds.", checkedAt }
    });
    // The reported defect: a green badge above "timed out". Both now read from one record.
    expect(screen.getByText("Timed out")).toBeTruthy();
    expect(screen.queryByText("Connected")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("timed out after 15 seconds");
    const time = container.querySelector("time");
    expect(time?.getAttribute("dateTime")).toBe(checkedAt);
    expect(time?.textContent).toMatch(/^Checked /);
  });

  it("prefers whichever of the reply and the recorded probe finished later", () => {
    card(
      {
        ...cloud,
        hasCredential: true,
        status: "CONNECTED",
        lastCheck: { provider: "experiential", status: "CONNECTED", latencyMs: 300, checkedAt: "2026-09-23T10:05:00.000Z" }
      },
      { testResult: { provider: "experiential", status: "TIMEOUT", message: "Older failure.", checkedAt: "2026-09-23T10:00:00.000Z" } }
    );
    expect(screen.getByRole("status").textContent).toContain("Reachable in 300ms");
  });

  it("dates a check from an earlier day, not only the time", () => {
    const now = new Date(2026, 8, 23, 12, 0);
    expect(formatCheckedAt(new Date(2026, 8, 23, 9, 30).toISOString(), now)).not.toMatch(/Sep|23/);
    expect(formatCheckedAt(new Date(2026, 8, 21, 9, 30).toISOString(), now)).toMatch(/21/);
  });

  it("expands the rest of the model list instead of labelling it", () => {
    const models = Array.from({ length: 7 }, (_, i) => ({ id: `m${i}`, name: `Model ${i}` }));
    card({ ...cloud, models });
    expect(screen.queryByText("Model 6")).toBeNull();
    const more = screen.getByRole("button", { name: "Show 3 more" });
    expect(more.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(more);
    expect(screen.getByText("Model 6")).toBeTruthy();
    const fewer = screen.getByRole("button", { name: "Show fewer" });
    expect(fewer.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(fewer);
    expect(screen.queryByText("Model 6")).toBeNull();
  });

  it("keeps Remove key out of the row that holds Save", () => {
    card({ ...cloud, hasCredential: true, status: "UNCHECKED" });
    const save = screen.getByRole("button", { name: /Save/ });
    const remove = screen.getByRole("button", { name: /Remove key/ });
    expect(save.parentElement).not.toBe(remove.parentElement);
    expect(save.parentElement?.contains(remove)).toBe(false);
  });

  it("shows testing in progress rather than leaving the button silent", () => {
    card(cloud, { testing: true });
    const button = screen.getByRole("button", { name: /Testing/ });
    expect(button.hasAttribute("disabled")).toBe(true);
  });
});

describe("SettingsView", () => {
  const providers = [cloud, local, { ...cloud, providerId: "openai", displayName: "OpenAI-Compatible", hasCredential: true, status: "CONNECTED" as const }];

  it("puts usable providers first, because that is the common question", () => {
    const { container } = render(
      <SettingsView providers={providers} testResults={{}} testing={undefined} onClose={() => {}} onSave={() => {}} onRemove={() => {}} onTest={() => {}} />
    );
    const names = [...container.querySelectorAll("h3")].map(h => h.textContent);
    expect(names).toEqual(["Ollama (Local)", "OpenAI-Compatible", "GPT-6 Astra (Experiential Labs)"]);
  });

  it("closes on request", () => {
    const onClose = vi.fn();
    render(<SettingsView providers={providers} testResults={{}} testing={undefined} onClose={onClose} onSave={() => {}} onRemove={() => {}} onTest={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("says so rather than rendering nothing when no catalogue has arrived", () => {
    render(<SettingsView providers={[]} testResults={{}} testing={undefined} onClose={() => {}} onSave={() => {}} onRemove={() => {}} onTest={() => {}} />);
    expect(screen.getByText("No providers available")).toBeTruthy();
  });

  it("routes save, remove and test to the right provider", () => {
    const onSave = vi.fn();
    const onRemove = vi.fn();
    const onTest = vi.fn();
    const { container } = render(
      <SettingsView providers={[cloud]} testResults={{}} testing={undefined} onClose={() => {}} onSave={onSave} onRemove={onRemove} onTest={onTest} />
    );
    const section = container.querySelector("section")!;
    fireEvent.change(within(section).getByLabelText("API key"), { target: { value: "k" } });
    fireEvent.click(within(section).getByRole("button", { name: /Save/ }));
    expect(onSave).toHaveBeenCalledWith("experiential", "k", "https://api.experientiallabs.ai/v1");

    fireEvent.click(within(section).getByRole("button", { name: /Test connection/ }));
    expect(onTest).toHaveBeenCalledWith("experiential", "k", "https://api.experientiallabs.ai/v1");
  });
});

describe("GPT-6 Astra catalogue entry", () => {
  // Read from source rather than importing model-core, which this package does not depend on.
  const profileSource = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../../packages/model-core/src/profiles/astra.ts"),
    "utf8"
  );

  it("points at the endpoint that actually exists", () => {
    expect(profileSource).toContain('defaultEndpoint: "https://api.experientiallabs.ai/v1"');
    // api.experiential.com does not resolve at all; a key would never have worked against it.
    expect(profileSource).not.toContain("api.experiential.com");
  });

  it("claims no price, because the listed one is promotional", () => {
    expect(profileSource).not.toMatch(/pricePerMillionTokens:\s*\{/);
    expect(profileSource).toContain("promotional");
  });
});
