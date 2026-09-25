import { type CodeSend, type TemplateSend, type WhatsappApi, WhatsappError } from "./whatsapp";

// Tests only: an in-memory WhatsApp number. Tokens other than `token` are
// refused; `down` makes it unreachable; numbers in `bad` are rejected by Meta.
export type FakeWhatsapp = { api: WhatsappApi; sent: (TemplateSend & { wamid: string })[]; codes: CodeSend[]; bad: Set<string>; down: boolean };

export function fakeWhatsapp(token = "EAAG-fake-access-token"): FakeWhatsapp {
  let n = 0;
  const fake: FakeWhatsapp = {
    sent: [],
    codes: [],
    bad: new Set(),
    down: false,
    api: ({ accessToken }) => {
      const guard = () => {
        if (fake.down) throw new WhatsappError("network", "Couldn't reach WhatsApp");
        if (accessToken !== token) throw new WhatsappError("auth", "WhatsApp didn't accept this access token");
      };
      return {
        async number() {
          guard();
          return { displayPhoneNumber: "+91 98200 00000", verifiedName: "Fake Academy" };
        },
        async sendTemplate(m) {
          guard();
          if (fake.bad.has(m.to)) throw new WhatsappError("api", "Recipient phone number not in allowed list");
          const wamid = `wamid.fake${++n}`;
          fake.sent.push({ ...m, wamid });
          return wamid;
        },
        async sendCode(m) {
          guard();
          fake.codes.push(m);
          return `wamid.code${fake.codes.length}`;
        },
      };
    },
  };
  return fake;
}
