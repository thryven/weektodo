import { describe, expect, it, vi } from "vitest";
import { ConsoleVerificationSender, WebhookVerificationSender } from "./verificationSender.mjs";

describe("verification delivery", () => {
  it("sends only the email template, recipient, and escaped public verification URL", async () => {
    const fetchMock=vi.fn().mockResolvedValue({ok:true});
    const originalFetch=globalThis.fetch;globalThis.fetch=fetchMock;
    try {
      const sender=new WebhookVerificationSender({url:"https://mailer.example/send",publicAppUrl:"https://planner.example/",
        authorization:"Bearer secret"});
      await sender.send({email:"user@example.com",token:"a+b/c"});
      const [url,request]=fetchMock.mock.calls[0];expect(url).toBe("https://mailer.example/send");
      expect(request.headers.authorization).toBe("Bearer secret");
      expect(JSON.parse(request.body)).toEqual({template:"verify-email",to:"user@example.com",
        verificationUrl:"https://planner.example/verify?token=a%2Bb%2Fc"});
    } finally { globalThis.fetch=originalFetch; }
  });

  it("prints an escaped verification link when using development delivery", async () => {
    const logger=vi.fn();const sender=new ConsoleVerificationSender({publicAppUrl:"http://localhost:5173/",logger});
    await sender.send({email:"user@example.com",token:"a+b/c"});
    expect(logger).toHaveBeenCalledWith(
      "[WeekToDo development] Verification for user@example.com: http://localhost:5173/verify?token=a%2Bb%2Fc");
  });
});
