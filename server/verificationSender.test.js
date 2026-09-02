import { describe, expect, it, vi } from "vitest";
import { ConsoleVerificationSender, ResendVerificationSender } from "./verificationSender.mjs";

describe("verification delivery", () => {
  it("sends a confirmation email through Resend with an escaped public verification URL", async () => {
    const fetchMock=vi.fn().mockResolvedValue({ok:true});
    const sender=new ResendVerificationSender({apiKey:"re_secret",from:"WeekToDo <accounts@planner.example>",
      publicAppUrl:"https://planner.example/",fetchImplementation:fetchMock});
    await sender.send({email:"user@example.com",token:"a+b/c"});
    const [url,request]=fetchMock.mock.calls[0];expect(url).toBe("https://api.resend.com/emails");
    expect(request.headers.authorization).toBe("Bearer re_secret");
    const body=JSON.parse(request.body);expect(body).toMatchObject({from:"WeekToDo <accounts@planner.example>",
      to:["user@example.com"],subject:"Confirm your WeekToDo account"});
    expect(body.html).toContain("https://planner.example/verify?token=a%2Bb%2Fc");
    expect(body.text).toContain("https://planner.example/verify?token=a%2Bb%2Fc");
  });

  it("reports rejected Resend deliveries",async()=>{
    const sender=new ResendVerificationSender({apiKey:"re_secret",from:"accounts@planner.example",
      publicAppUrl:"https://planner.example",fetchImplementation:vi.fn().mockResolvedValue({ok:false})});
    await expect(sender.send({email:"user@example.com",token:"token"})).rejects.toThrow("VERIFICATION_DELIVERY_FAILED");
  });

  it("prints an escaped verification link when using development delivery", async () => {
    const logger=vi.fn();const sender=new ConsoleVerificationSender({publicAppUrl:"http://localhost:5173/",logger});
    await sender.send({email:"user@example.com",token:"a+b/c"});
    expect(logger).toHaveBeenCalledWith(
      "[WeekToDo development] Verification for user@example.com: http://localhost:5173/verify?token=a%2Bb%2Fc");
  });
});
