import { PrivateImage } from "../chat/domain";
import { redactAttachmentKeys } from "./redactAttachmentKeys";

const image = new PrivateImage({
  url: "https://blossom.test/image",
  fileType: "image/jpeg",
  encryptionAlgorithm: "aes-gcm",
  key: "01".repeat(32),
  nonce: "02".repeat(12),
  encryptedSha256: "03".repeat(32),
  originalSha256: "04".repeat(32),
  encryptedSize: 1234,
  width: 640,
  height: 480,
  storageEncoding: "base64",
});

describe("redactAttachmentKeys", () => {
  it("strips key and nonce from an attachment nested anywhere in the value", () => {
    const redacted = redactAttachmentKeys({
      ref: "row-1",
      operation: { _tag: "chat.image", draft: { to: "peer", image } },
      list: [image],
    });

    expect(redacted).toEqual({
      ref: "row-1",
      operation: {
        _tag: "chat.image",
        draft: {
          to: "peer",
          image: {
            url: "https://blossom.test/image",
            fileType: "image/jpeg",
            encryptionAlgorithm: "aes-gcm",
            encryptedSha256: "03".repeat(32),
            originalSha256: "04".repeat(32),
            encryptedSize: 1234,
            width: 640,
            height: 480,
            storageEncoding: "base64",
          },
        },
      },
      list: [expect.not.objectContaining({ key: expect.anything() })],
    });
    expect(JSON.stringify(redacted)).not.toContain("01".repeat(32));
    expect(JSON.stringify(redacted)).not.toContain("02".repeat(12));
  });

  it("returns the same reference when nothing needs redacting", () => {
    const value = {
      draft: { to: "peer", content: "hello", key: "a storage key" },
      tags: [["p", "peer"]],
      count: 3,
    };

    expect(redactAttachmentKeys(value)).toBe(value);
    expect(redactAttachmentKeys("text")).toBe("text");
    expect(redactAttachmentKeys(null)).toBe(null);
  });
});
