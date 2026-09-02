function verificationUrl(publicAppUrl, token) {
  return `${publicAppUrl.replace(/\/$/, "")}/verify?token=${encodeURIComponent(token)}`;
}

export class WebhookVerificationSender {
  constructor({ url, publicAppUrl, authorization }) {
    this.url = url; this.publicAppUrl = publicAppUrl; this.authorization = authorization;
  }
  async send({ email, token }) {
    const response = await fetch(this.url, { method: "POST", headers: { "content-type": "application/json",
      ...(this.authorization ? { authorization: this.authorization } : {}) }, body: JSON.stringify({
      template: "verify-email", to: email, verificationUrl: verificationUrl(this.publicAppUrl, token),
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
