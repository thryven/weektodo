function verificationUrl(publicAppUrl, token) {
  return `${publicAppUrl.replace(/\/$/, "")}/verify?token=${encodeURIComponent(token)}`;
}

function verificationEmailHtml(url) {
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#202124;line-height:1.5">
    <div style="max-width:560px;margin:0 auto;padding:32px 20px">
      <h1 style="font-size:24px">Confirm your WeekToDo account</h1>
      <p>Confirm your email address to finish creating your encrypted sync account.</p>
      <p style="margin:28px 0"><a href="${url}" style="background:#0d6efd;color:#fff;padding:12px 18px;text-decoration:none;border-radius:6px">Confirm email</a></p>
      <p style="font-size:13px;color:#5f6368">This link expires in 24 hours. If you didn’t create this account, you can ignore this email.</p>
    </div></body></html>`;
}

export class ResendVerificationSender {
  constructor({ apiKey, from, publicAppUrl, fetchImplementation = globalThis.fetch }) {
    this.apiKey = apiKey; this.from = from; this.publicAppUrl = publicAppUrl;
    this.fetch = fetchImplementation.bind(globalThis);
  }
  async send({ email, token }) {
    const url=verificationUrl(this.publicAppUrl,token);
    const response = await this.fetch("https://api.resend.com/emails", { method: "POST", headers: {
      "content-type": "application/json",authorization:`Bearer ${this.apiKey}` }, body: JSON.stringify({
      from:this.from,to:[email],subject:"Confirm your WeekToDo account",html:verificationEmailHtml(url),
      text:`Confirm your WeekToDo account: ${url}\n\nThis link expires in 24 hours.`,
    }) });
    if (!response.ok) throw new Error("VERIFICATION_DELIVERY_FAILED");
  }
}

export class ConsoleVerificationSender {
  constructor({ publicAppUrl, logger = console.info }) {
    this.publicAppUrl = publicAppUrl; this.logger = logger;
  }
  async send({ email, token }) {
    this.logger(`[WeekToDo development] Verification for ${email}: ${verificationUrl(this.publicAppUrl, token)}`);
  }
}
