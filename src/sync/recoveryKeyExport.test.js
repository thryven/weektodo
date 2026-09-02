import { describe,expect,it,vi } from "vitest";
import { copyRecoveryKey,downloadRecoveryKey,recoveryKeyDocument,recoveryKeyFilename } from "./recoveryKeyExport";

describe("recovery key export",()=>{
  it("copies only the recovery key",async()=>{
    const clipboard={writeText:vi.fn().mockResolvedValue()};
    await copyRecoveryKey("wtd1.secret",clipboard);
    expect(clipboard.writeText).toHaveBeenCalledWith("wtd1.secret");
  });

  it("creates a useful recovery document",()=>{
    const content=recoveryKeyDocument("wtd1.secret","person@example.com",new Date("2026-09-02T00:00:00.000Z"));
    expect(content).toContain("wtd1.secret");
    expect(content).toContain("Account: person@example.com");
    expect(content).toContain("Created: 2026-09-02T00:00:00.000Z");
  });

  it("downloads the recovery document as a text file",()=>{
    const link={style:{},click:vi.fn(),remove:vi.fn()};
    const document={createElement:vi.fn(()=>link),body:{appendChild:vi.fn()}};
    const url={createObjectURL:vi.fn(()=>"blob:recovery"),revokeObjectURL:vi.fn()};
    class BlobType { constructor(parts,options){this.parts=parts;this.options=options;} }
    downloadRecoveryKey("wtd1.secret","person@example.com",{document,url,BlobType});
    expect(link.download).toBe(recoveryKeyFilename);
    expect(link.click).toHaveBeenCalledOnce();
    expect(url.revokeObjectURL).toHaveBeenCalledWith("blob:recovery");
  });
});
