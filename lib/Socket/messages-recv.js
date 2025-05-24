var __importDefault =
  (this && this.__importDefault) ||
  function (u) {
    if (u && u.__esModule) {
      return u;
    } else {
      return {
        default: u,
      };
    }
  };
Object.defineProperty(exports, "__esModule", {
  value: true,
});
exports.makeMessagesRecvSocket = undefined;
const node_cache_1 = __importDefault(require("@cacheable/node-cache"));
const boom_1 = require("@hapi/boom");
const crypto_1 = require("crypto");
const WAProto_1 = require("../../WAProto");
const Defaults_1 = require("../Defaults");
const Types_1 = require("../Types");
const Utils_1 = require("../Utils");
const make_mutex_1 = require("../Utils/make-mutex");
const WABinary_1 = require("../WABinary");
const groups_1 = require("./groups");
const messages_send_1 = require("./messages-send");
const makeMessagesRecvSocket = (u) => {
  async function W(a) {
    a = z(a);
    var b = a.slice(0, 32);
    b = await (0, Utils_1.derivePairingCodeKey)(k.creds.pairingCode, b);
    const c = a.slice(32, 48);
    a = a.slice(48, 80);
    return (0, Utils_1.aesDecryptCTR)(a, b, c);
  }
  function z(a) {
    if (a === undefined) {
      throw new boom_1.Boom("Invalid buffer", {
        statusCode: 400,
      });
    }
    if (a instanceof Buffer) {
      return a;
    } else {
      return Buffer.from(a);
    }
  }
  const { logger: m, retryRequestDelayMs: K, maxMsgRetryCount: L, getMessage: X, shouldIgnoreJid: D } = u;
  const E = (0, messages_send_1.makeMessagesSocket)(u);
  const {
    ev: p,
    authState: k,
    ws: v,
    processingMutex: F,
    signalRepository: Y,
    query: M,
    upsertMessage: G,
    resyncAppState: Z,
    onUnexpectedError: A,
    assertSessions: aa,
    sendNode: N,
    relayMessage: ba,
    sendReceipt: O,
    uploadPreKeys: ca,
    sendPeerDataOperationMessage: P,
  } = E;
  const da = (0, make_mutex_1.makeMutex)();
  const x =
    u.msgRetryCounterCache ||
    new node_cache_1.default({
      stdTTL: Defaults_1.DEFAULT_CACHE_TTLS.MSG_RETRY,
      useClones: false,
    });
  const H =
    u.callOfferCache ||
    new node_cache_1.default({
      stdTTL: Defaults_1.DEFAULT_CACHE_TTLS.CALL_OFFER,
      useClones: false,
    });
  const w =
    u.placeholderResendCache ||
    new node_cache_1.default({
      stdTTL: Defaults_1.DEFAULT_CACHE_TTLS.MSG_RETRY,
      useClones: false,
    });
  let I = false;
  const t = async ({ tag: a, attrs: b, content: c }, d) => {
    const f = {
      tag: "ack",
      attrs: {
        id: b.id,
        to: b.from,
        class: a,
      },
    };
    if (d) {
      f.attrs.error = d.toString();
    }
    if (b.participant) {
      f.attrs.participant = b.participant;
    }
    if (b.recipient) {
      f.attrs.recipient = b.recipient;
    }
    if (
      b.type &&
      (a !== "message" ||
        (0, WABinary_1.getBinaryNodeChild)(
          {
            tag: a,
            attrs: b,
            content: c,
          },
          "unavailable",
        ) ||
        d !== 0)
    ) {
      f.attrs.type = b.type;
    }
    if (
      a === "message" &&
      (0, WABinary_1.getBinaryNodeChild)(
        {
          tag: a,
          attrs: b,
          content: c,
        },
        "unavailable",
      )
    ) {
      f.attrs.from = k.creds.me.id;
    }
    m.debug(
      {
        recv: {
          tag: a,
          attrs: b,
        },
        sent: f.attrs,
      },
      "sent ack",
    );
    await N(f);
  };
  const R = async (a, b = false) => {
    var { fullMessage: c } = (0, Utils_1.decodeMessageNode)(a, k.creds.me.id, k.creds.me.lid || "");
    ({ key: c } = c);
    const d = c.id;
    const f = `${d}:${c?.participant}`;
    let e = x.get(f) || 0;
    if (e >= L) {
      m.debug(
        {
          retryCount: e,
          msgId: d,
        },
        "reached retry limit, clearing",
      );
      x.del(f);
    } else {
      e += 1;
      x.set(f, e);
      var { account: g, signedPreKey: l, signedIdentityKey: h } = k.creds;
      if (e === 1) {
        c = await J(c);
        m.debug(`sendRetryRequest: requested placeholder resend for message ${c}`);
      }
      var q = (0, Utils_1.encodeSignedDeviceIdentity)(g, true);
      await k.keys.transaction(async () => {
        const n = {
          tag: "receipt",
          attrs: {
            id: d,
            type: "retry",
            to: a.attrs.from,
          },
          content: [
            {
              tag: "retry",
              attrs: {
                count: e.toString(),
                id: a.attrs.id,
                t: a.attrs.t,
                v: "1",
              },
            },
            {
              tag: "registration",
              attrs: {},
              content: (0, Utils_1.encodeBigEndian)(k.creds.registrationId),
            },
          ],
        };
        if (a.attrs.recipient) {
          n.attrs.recipient = a.attrs.recipient;
        }
        if (a.attrs.participant) {
          n.attrs.participant = a.attrs.participant;
        }
        if (e > 1 || b) {
          const { update: r, preKeys: y } = await (0, Utils_1.getNextPreKeys)(k, 1);
          const [Q] = Object.keys(y);
          const ea = y[+Q];
          n.content.push({
            tag: "keys",
            attrs: {},
            content: [
              {
                tag: "type",
                attrs: {},
                content: Buffer.from(Defaults_1.KEY_BUNDLE_TYPE),
              },
              {
                tag: "identity",
                attrs: {},
                content: h.public,
              },
              (0, Utils_1.xmppPreKey)(ea, +Q),
              (0, Utils_1.xmppSignedPreKey)(l),
              {
                tag: "device-identity",
                attrs: {},
                content: q,
              },
            ],
          });
          p.emit("creds.update", r);
        }
        await N(n);
        m.info(
          {
            msgAttrs: a.attrs,
            retryCount: e,
          },
          "sent retry receipt",
        );
      });
    }
  };
  const fa = async (a) => {
    var b = a.attrs.from;
    if (b === WABinary_1.S_WHATSAPP_NET) {
      a = +(0, WABinary_1.getBinaryNodeChild)(a, "count").attrs.value;
      b = a < Defaults_1.MIN_PREKEY_COUNT;
      m.debug(
        {
          count: a,
          shouldUploadMorePreKeys: b,
        },
        "recv pre-key count",
      );
      if (b) {
        await ca();
      }
    } else if ((0, WABinary_1.getBinaryNodeChild)(a, "identity")) {
      m.info(
        {
          jid: b,
        },
        "identity changed",
      );
    } else {
      m.info(
        {
          node: a,
        },
        "unknown encrypt notification",
      );
    }
  };
  const ha = (a, b, c) => {
    var e;
    const g = (0, WABinary_1.getBinaryNodeChild)(b, "participant")?.attrs?.jid || a;
    switch (b?.tag) {
      case "create":
        b = (0, groups_1.extractGroupMetadata)(b);
        c.messageStubType = Types_1.WAMessageStubType.GROUP_CREATE;
        c.messageStubParameters = [b.subject];
        c.key = {
          participant: b.owner,
        };
        p.emit("chats.upsert", [
          {
            id: b.id,
            name: b.subject,
            conversationTimestamp: b.creation,
          },
        ]);
        p.emit("groups.upsert", [
          {
            ...b,
            author: a,
          },
        ]);
        break;
      case "ephemeral":
      case "not_ephemeral":
        c.message = {
          protocolMessage: {
            type: WAProto_1.proto.Message.ProtocolMessage.Type.EPHEMERAL_SETTING,
            ephemeralExpiration: +(b.attrs.expiration || 0),
          },
        };
        break;
      case "modify":
        a = (0, WABinary_1.getBinaryNodeChildren)(b, "participant").map((h) => h.attrs.jid);
        c.messageStubParameters = a || [];
        c.messageStubType = Types_1.WAMessageStubType.GROUP_PARTICIPANT_CHANGE_NUMBER;
        break;
      case "promote":
      case "demote":
      case "remove":
      case "add":
      case "leave":
        var l = `GROUP_PARTICIPANT_${b.tag.toUpperCase()}`;
        c.messageStubType = Types_1.WAMessageStubType[l];
        l = (0, WABinary_1.getBinaryNodeChildren)(b, "participant").map((h) => h.attrs.jid);
        if (l.length === 1 && (0, WABinary_1.areJidsSameUser)(l[0], a) && b.tag === "remove") {
          c.messageStubType = Types_1.WAMessageStubType.GROUP_PARTICIPANT_LEAVE;
        }
        c.messageStubParameters = l;
        break;
      case "subject":
        c.messageStubType = Types_1.WAMessageStubType.GROUP_CHANGE_SUBJECT;
        c.messageStubParameters = [b.attrs.subject];
        break;
      case "description":
        a =
          (e =
            (l = (0, WABinary_1.getBinaryNodeChild)(b, "body")) === null || l === undefined ? undefined : l.content) ===
            null || e === undefined
            ? undefined
            : e.toString();
        c.messageStubType = Types_1.WAMessageStubType.GROUP_CHANGE_DESCRIPTION;
        c.messageStubParameters = a ? [a] : undefined;
        break;
      case "announcement":
      case "not_announcement":
        c.messageStubType = Types_1.WAMessageStubType.GROUP_CHANGE_ANNOUNCE;
        c.messageStubParameters = [b.tag === "announcement" ? "on" : "off"];
        break;
      case "locked":
      case "unlocked":
        c.messageStubType = Types_1.WAMessageStubType.GROUP_CHANGE_RESTRICT;
        c.messageStubParameters = [b.tag === "locked" ? "on" : "off"];
        break;
      case "invite":
        c.messageStubType = Types_1.WAMessageStubType.GROUP_CHANGE_INVITE_LINK;
        c.messageStubParameters = [b.attrs.code];
        break;
      case "member_add_mode":
        if ((a = b.content)) {
          c.messageStubType = Types_1.WAMessageStubType.GROUP_MEMBER_ADD_MODE;
          c.messageStubParameters = [a.toString()];
        }
        break;
      case "membership_approval_mode":
        if ((a = (0, WABinary_1.getBinaryNodeChild)(b, "group_join"))) {
          c.messageStubType = Types_1.WAMessageStubType.GROUP_MEMBERSHIP_JOIN_APPROVAL_MODE;
          c.messageStubParameters = [a.attrs.state];
        }
        break;
      case "created_membership_requests":
        c.messageStubType = Types_1.WAMessageStubType.GROUP_MEMBERSHIP_JOIN_APPROVAL_REQUEST_NON_ADMIN_ADD;
        c.messageStubParameters = [g, "created", b.attrs.request_method];
        break;
      case "revoked_membership_requests":
        a = (0, WABinary_1.areJidsSameUser)(g, a);
        c.messageStubType = Types_1.WAMessageStubType.GROUP_MEMBERSHIP_JOIN_APPROVAL_REQUEST_NON_ADMIN_ADD;
        c.messageStubParameters = [g, a ? "revoked" : "rejected"];
    }
  };
  const ia = async (a) => {
    var b;
    var c;
    var d;
    const f = {};
    var [e] = (0, WABinary_1.getAllBinaryNodeChildren)(a);
    var g = a.attrs.type;
    var l = (0, WABinary_1.jidNormalizedUser)(a.attrs.from);
    switch (g) {
      case "privacy_token":
        a = (0, WABinary_1.getBinaryNodeChildren)(e, "token");
        for (const { attrs: q, content: n } of a) {
          a = q.jid;
          p.emit("chats.update", [
            {
              id: a,
              tcToken: n,
            },
          ]);
          m.debug(
            {
              jid: a,
            },
            "got privacy token update",
          );
        }
        break;
      case "w:gp2":
        ha(a.attrs.participant, e, f);
        break;
      case "mediaretry":
        a = (0, Utils_1.decodeMediaRetryNode)(a);
        p.emit("messages.media-update", [a]);
        break;
      case "encrypt":
        await fa(a);
        break;
      case "devices":
        a = (0, WABinary_1.getBinaryNodeChildren)(e, "device");
        if ((0, WABinary_1.areJidsSameUser)(e.attrs.jid, k.creds.me.id)) {
          a = a.map((q) => q.attrs.jid);
          m.info(
            {
              deviceJids: a,
            },
            "got my own devices",
          );
        }
        break;
      case "server_sync":
        if ((a = (0, WABinary_1.getBinaryNodeChild)(a, "collection"))) {
          await Z([a.attrs.name], false);
        }
        break;
      case "picture":
        e = (0, WABinary_1.getBinaryNodeChild)(a, "set");
        var h = (0, WABinary_1.getBinaryNodeChild)(a, "delete");
        p.emit("contacts.update", [
          {
            id:
              (0, WABinary_1.jidNormalizedUser)((b = a?.attrs) === null || b === undefined ? undefined : b.from) ||
              ((d = (c = e || h) === null || c === undefined ? undefined : c.attrs) === null || d === undefined
                ? undefined
                : d.hash) ||
              "",
            imgUrl: e ? "changed" : "removed",
          },
        ]);
        if ((0, WABinary_1.isJidGroup)(l)) {
          a = e || h;
          f.messageStubType = Types_1.WAMessageStubType.GROUP_CHANGE_ICON;
          if (e) {
            f.messageStubParameters = [e.attrs.id];
          }
          f.participant = a === null || a === undefined ? undefined : a.attrs.author;
          f.key = {
            ...(f.key || {}),
            participant: e === null || e === undefined ? undefined : e.attrs.author,
          };
        }
        break;
      case "account_sync":
        if (e.tag === "disappearing_mode") {
          a = +e.attrs.duration;
          b = +e.attrs.t;
          m.info(
            {
              newDuration: a,
            },
            "updated account disappearing mode",
          );
          p.emit("creds.update", {
            accountSettings: {
              ...k.creds.accountSettings,
              defaultDisappearingMode: {
                ephemeralExpiration: a,
                ephemeralSettingTimestamp: b,
              },
            },
          });
        } else if (e.tag === "blocklist") {
          a = (0, WABinary_1.getBinaryNodeChildren)(e, "item");
          for ({ attrs: h } of a) {
            p.emit("blocklist.update", {
              blocklist: [h.jid],
              type: h.action === "block" ? "add" : "remove",
            });
          }
        }
        break;
      case "link_code_companion_reg":
        c = (0, WABinary_1.getBinaryNodeChild)(a, "link_code_companion_reg");
        a = z((0, WABinary_1.getBinaryNodeChildBuffer)(c, "link_code_pairing_ref"));
        b = z((0, WABinary_1.getBinaryNodeChildBuffer)(c, "primary_identity_pub"));
        c = z((0, WABinary_1.getBinaryNodeChildBuffer)(c, "link_code_pairing_wrapped_primary_ephemeral_pub"));
        c = await W(c);
        c = Utils_1.Curve.sharedKey(k.creds.pairingEphemeralKeyPair.private, c);
        d = (0, crypto_1.randomBytes)(32);
        e = (0, crypto_1.randomBytes)(32);
        h = await (0, Utils_1.hkdf)(c, 32, {
          salt: e,
          info: "link_code_pairing_key_bundle_encryption_key",
        });
        g = Buffer.concat([Buffer.from(k.creds.signedIdentityKey.public), b, d]);
        l = (0, crypto_1.randomBytes)(12);
        h = (0, Utils_1.aesEncryptGCM)(g, h, l, Buffer.alloc(0));
        e = Buffer.concat([e, l, h]);
        b = Utils_1.Curve.sharedKey(k.creds.signedIdentityKey.private, b);
        b = Buffer.concat([c, b, d]);
        k.creds.advSecretKey = (
          await (0, Utils_1.hkdf)(b, 32, {
            info: "adv_secret",
          })
        ).toString("base64");
        await M({
          tag: "iq",
          attrs: {
            to: WABinary_1.S_WHATSAPP_NET,
            type: "set",
            id: E.generateMessageTag(),
            xmlns: "md",
          },
          content: [
            {
              tag: "link_code_companion_reg",
              attrs: {
                jid: k.creds.me.id,
                stage: "companion_finish",
              },
              content: [
                {
                  tag: "link_code_pairing_wrapped_key_bundle",
                  attrs: {},
                  content: e,
                },
                {
                  tag: "companion_identity_public",
                  attrs: {},
                  content: k.creds.signedIdentityKey.public,
                },
                {
                  tag: "link_code_pairing_ref",
                  attrs: {},
                  content: a,
                },
              ],
            },
          ],
        });
        k.creds.registered = true;
        p.emit("creds.update", k.creds);
    }
    if (Object.keys(f).length) {
      return f;
    }
  };
  const ja = (a, b) => {
    a = `${a}:${b}`;
    b = (x.get(a) || 0) + 1;
    x.set(a, b);
  };
  const ka = async (a, b, c) => {
    var d;
    const f = await Promise.all(
      b.map((h) =>
        X({
          ...a,
          id: h,
        }),
      ),
    );
    const e = a.remoteJid;
    const g = a.participant || e;
    const l = !((d = (0, WABinary_1.jidDecode)(g)) === null || d === undefined ? 0 : d.device);
    await aa([g], true);
    if ((0, WABinary_1.isJidGroup)(e)) {
      await k.keys.set({
        "sender-key-memory": {
          [e]: null,
        },
      });
    }
    m.debug(
      {
        participant: g,
        sendToAll: l,
      },
      "forced new session for retry recp",
    );
    for (const [h, q] of f.entries()) {
      if (q) {
        ja(b[h], g);
        d = {
          messageId: b[h],
        };
        if (l) {
          d.useUserDevicesCache = false;
        } else {
          d.participant = {
            jid: g,
            count: +c.attrs.count,
          };
        }
        await ba(a.remoteJid, q, d);
      } else {
        m.debug(
          {
            jid: a.remoteJid,
            id: b[h],
          },
          "recv retry request, but message not available",
        );
      }
    }
  };
  const S = async (a) => {
    var b;
    const { attrs: d, content: f } = a;
    const e = d.from.includes("lid");
    const g = (0, WABinary_1.areJidsSameUser)(
      d.participant || d.from,
      e ? ((b = k.creds.me) === null || b === undefined ? undefined : b.lid) : k.creds.me?.id,
    );
    const l = !g || (0, WABinary_1.isJidGroup)(d.from) ? d.from : d.recipient;
    const h = {
      remoteJid: l,
      id: "",
      fromMe: !d.recipient || ((d.type === "retry" || d.type === "sender") && g),
      participant: d.participant,
    };
    if (D(l) && l !== "@s.whatsapp.net") {
      m.debug(
        {
          remoteJid: l,
        },
        "ignoring receipt from jid",
      );
      await t(a);
    } else {
      var q = [d.id];
      if (Array.isArray(f)) {
        b = (0, WABinary_1.getBinaryNodeChildren)(f[0], "item");
        q.push(...b.map((n) => n.attrs.id));
      }
      try {
        await Promise.all([
          F.mutex(async () => {
            const n = (0, Utils_1.getStatusFromReceiptType)(d.type);
            if (typeof n !== "undefined" && (n >= WAProto_1.proto.WebMessageInfo.Status.SERVER_ACK || !g)) {
              if ((0, WABinary_1.isJidGroup)(l) || (0, WABinary_1.isJidStatusBroadcast)(l)) {
                if (d.participant) {
                  const r =
                    n === WAProto_1.proto.WebMessageInfo.Status.DELIVERY_ACK ? "receiptTimestamp" : "readTimestamp";
                  p.emit(
                    "message-receipt.update",
                    q.map((y) => ({
                      key: {
                        ...h,
                        id: y,
                      },
                      receipt: {
                        userJid: (0, WABinary_1.jidNormalizedUser)(d.participant),
                        [r]: +d.t,
                      },
                    })),
                  );
                }
              } else {
                p.emit(
                  "messages.update",
                  q.map((r) => ({
                    key: {
                      ...h,
                      id: r,
                    },
                    update: {
                      status: n,
                    },
                  })),
                );
              }
            }
            if (d.type === "retry") {
              h.participant = h.participant || d.from;
              const r = (0, WABinary_1.getBinaryNodeChild)(a, "retry");
              if ((x.get(`${q[0]}:${h.participant}`) || 0) < L) {
                if (h.fromMe) {
                  try {
                    m.debug(
                      {
                        attrs: d,
                        key: h,
                      },
                      "recv retry request",
                    );
                    await ka(h, q, r);
                  } catch (y) {
                    m.error(
                      {
                        key: h,
                        ids: q,
                        trace: y.stack,
                      },
                      "error in sending message again",
                    );
                  }
                } else {
                  m.info(
                    {
                      attrs: d,
                      key: h,
                    },
                    "recv retry for not fromMe message",
                  );
                }
              } else {
                m.info(
                  {
                    attrs: d,
                    key: h,
                  },
                  "will not send message again, as sent too many times",
                );
              }
            }
          }),
        ]);
      } finally {
        await t(a);
      }
    }
  };
  const T = async (a) => {
    const b = a.attrs.from;
    if (D(b) && b !== "@s.whatsapp.net") {
      m.debug(
        {
          remoteJid: b,
          id: a.attrs.id,
        },
        "ignored notification",
      );
      await t(a);
    } else {
      try {
        await Promise.all([
          F.mutex(async () => {
            var c;
            const d = await ia(a);
            if (d) {
              const f = (0, WABinary_1.areJidsSameUser)(a.attrs.participant || b, k.creds.me.id);
              d.key = {
                remoteJid: b,
                fromMe: f,
                participant: a.attrs.participant,
                id: a.attrs.id,
                ...(d.key || {}),
              };
              if ((c = d.participant) !== null && c !== undefined) {
                c;
              } else {
                d.participant = a.attrs.participant;
              }
              d.messageTimestamp = +a.attrs.t;
              c = WAProto_1.proto.WebMessageInfo.fromObject(d);
              await G(c, "append");
            }
          }),
        ]);
      } finally {
        await t(a);
      }
    }
  };
  const U = async (a) => {
    if (D(a.attrs.from) && a.attrs.from !== "@s.whatsapp.net") {
      m.debug(
        {
          key: a.attrs.key,
        },
        "ignored message",
      );
      await t(a);
    } else {
      var f = (0, WABinary_1.getBinaryNodeChild)(a, "enc");
      if (f && f.attrs.type === "msmsg") {
        m.debug(
          {
            key: a.attrs.key,
          },
          "ignored msmsg",
        );
        await t(a);
      } else {
        if ((0, WABinary_1.getBinaryNodeChild)(a, "unavailable") && !f) {
          await t(a);
          ({ key: f } = (0, Utils_1.decodeMessageNode)(a, k.creds.me.id, k.creds.me.lid || "").fullMessage);
          var e = await J(f);
          if (e === "RESOLVED") {
            return;
          }
          m.debug("received unavailable message, acked and requested resend from phone");
        } else if (w.get(a.attrs.id)) {
          w.del(a.attrs.id);
        }
        var {
          fullMessage: g,
          category: l,
          author: h,
          decrypt: q,
        } = (0, Utils_1.decryptMessageNode)(a, k.creds.me.id, k.creds.me.lid || "", Y, m);
        if (e && g?.messageStubParameters?.[0] === Utils_1.NO_MESSAGE_FOUND_ERROR_TEXT) {
          g.messageStubParameters = [Utils_1.NO_MESSAGE_FOUND_ERROR_TEXT, e];
        }
        if (
          g.message?.protocolMessage?.type === WAProto_1.proto.Message.ProtocolMessage.Type.SHARE_PHONE_NUMBER &&
          a.attrs.sender_pn
        ) {
          p.emit("chats.phoneNumberShare", {
            lid: a.attrs.from,
            jid: a.attrs.sender_pn,
          });
        }
        try {
          await Promise.all([
            F.mutex(async () => {
              var n;
              await q();
              if (g.messageStubType === WAProto_1.proto.WebMessageInfo.StubType.CIPHERTEXT) {
                if (
                  ((n = g?.messageStubParameters) === null || n === undefined ? undefined : n[0]) ===
                  Utils_1.MISSING_KEYS_ERROR_TEXT
                ) {
                  return t(a, Utils_1.NACK_REASONS.ParsingError);
                }
                da.mutex(async () => {
                  if (v.isOpen) {
                    if (!(0, WABinary_1.getBinaryNodeChild)(a, "unavailable")) {
                      var r = (0, WABinary_1.getBinaryNodeChild)(a, "enc");
                      await R(a, !r);
                      if (K) {
                        await (0, Utils_1.delay)(K);
                      }
                    }
                  } else {
                    m.debug(
                      {
                        node: a,
                      },
                      "connection closed, ignoring retry req",
                    );
                  }
                });
              } else {
                n = undefined;
                let r = g.key.participant;
                if (l === "peer") {
                  n = "peer_msg";
                } else if (g.key.fromMe) {
                  n = "sender";
                  if ((0, WABinary_1.isJidUser)(g.key.remoteJid)) {
                    r = h;
                  }
                } else if (!I) {
                  n = "inactive";
                }
                await O(g.key.remoteJid, r, [g.key.id], n);
                if ((0, Utils_1.getHistoryMsg)(g.message)) {
                  n = (0, WABinary_1.jidNormalizedUser)(g.key.remoteJid);
                  await O(n, undefined, [g.key.id], "hist_sync");
                }
              }
              (0, Utils_1.cleanMessage)(g, k.creds.me.id);
              await t(a);
              await G(g, a.attrs.offline ? "append" : "notify");
            }),
          ]);
        } catch (n) {
          m.error(
            {
              error: n,
              node: a,
            },
            "error in handling message",
          );
        }
      }
    }
  };
  const J = async (a) => {
    var b;
    if ((b = k.creds.me) === null || b === undefined || !b.id) {
      throw new boom_1.Boom("Not authenticated");
    }
    if (w.get(a?.id)) {
      m.debug(
        {
          messageKey: a,
        },
        "already requested resend",
      );
    } else {
      w.set(a?.id, true);
      await (0, Utils_1.delay)(5000);
      if (!w.get(a?.id)) {
        m.debug(
          {
            messageKey: a,
          },
          "message received while resend requested",
        );
        return "RESOLVED";
      }
      b = {
        placeholderMessageResendRequest: [
          {
            messageKey: a,
          },
        ],
        peerDataOperationRequestType: WAProto_1.proto.Message.PeerDataOperationRequestType.PLACEHOLDER_MESSAGE_RESEND,
      };
      setTimeout(() => {
        if (w.get(a?.id)) {
          m.debug(
            {
              messageKey: a,
            },
            "PDO message without response after 15 seconds. Phone possibly offline",
          );
          w.del(a?.id);
        }
      }, 15000);
      return P(b);
    }
  };
  const V = async (a) => {
    var { attrs: b } = a;
    var [c] = (0, WABinary_1.getAllBinaryNodeChildren)(a);
    const d = c.attrs["call-id"];
    const f = c.attrs.from || c.attrs["call-creator"];
    const e = (0, Utils_1.getCallStatusFromNode)(c);
    b = {
      chatId: b.from,
      from: f,
      id: d,
      date: new Date(+b.t * 1000),
      offline: !!b.offline,
      status: e,
    };
    if (e === "offer") {
      b.isVideo = !!(0, WABinary_1.getBinaryNodeChild)(c, "video");
      b.isGroup = c.attrs.type === "group" || !!c.attrs["group-jid"];
      b.groupJid = c.attrs["group-jid"];
      H.set(b.id, b);
    }
    if ((c = H.get(b.id))) {
      b.isVideo = c.isVideo;
      b.isGroup = c.isGroup;
    }
    if (e === "reject" || e === "accept" || e === "timeout" || e === "terminate") {
      H.del(b.id);
    }
    p.emit("call", [b]);
    await t(a);
  };
  const la = async ({ attrs: a }) => {
    const b = {
      remoteJid: a.from,
      fromMe: true,
      id: a.id,
    };
    if (a.error) {
      m.warn(
        {
          attrs: a,
        },
        "received error in ack",
      );
      p.emit("messages.update", [
        {
          key: b,
          update: {
            status: Types_1.WAMessageStatus.ERROR,
            messageStubParameters: [a.error],
          },
        },
      ]);
    }
  };
  const B = async (a, b, c) => {
    p.buffer();
    await (function () {
      return c(a, false).catch((d) => A(d, b));
    })();
    p.flush();
  };
  const C = (() => {
    const a = new Map([
      ["message", U],
      ["call", V],
      ["receipt", S],
      ["notification", T],
    ]);
    const b = [];
    let c = false;
    return {
      enqueue: (d, f) => {
        b.push({
          type: d,
          node: f,
        });
        if (!c) {
          c = true;
          (async () => {
            while (b.length && v.isOpen) {
              const { type: e, node: g } = b.shift();
              const l = a.get(e);
              if (l) {
                await l(g);
              } else {
                A(Error(`unknown offline node type: ${e}`), "processing offline node");
              }
            }
            c = false;
          })().catch((e) => A(e, "processing offline nodes"));
        }
      },
    };
  })();
  v.on("CB:message", (a) => {
    if (a.attrs.offline) {
      C.enqueue("message", a);
    } else {
      B(a, "processing message", U);
    }
  });
  v.on("CB:call", async (a) => {
    if (a.attrs.offline) {
      C.enqueue("call", a);
    } else {
      B(a, "handling call", V);
    }
  });
  v.on("CB:receipt", (a) => {
    if (a.attrs.offline) {
      C.enqueue("receipt", a);
    } else {
      B(a, "handling receipt", S);
    }
  });
  v.on("CB:notification", async (a) => {
    if (a.attrs.offline) {
      C.enqueue("notification", a);
    } else {
      B(a, "handling notification", T);
    }
  });
  v.on("CB:ack,class:message", (a) => {
    la(a).catch((b) => A(b, "handling bad ack"));
  });
  p.on("call", ([a]) => {
    if (a.status === "timeout" || (a.status === "offer" && a.isGroup)) {
      var b = {
        key: {
          remoteJid: a.chatId,
          id: a.id,
          fromMe: false,
        },
        messageTimestamp: (0, Utils_1.unixTimestampSeconds)(a.date),
      };
      if (a.status === "timeout") {
        b.messageStubType = a.isGroup
          ? a.isVideo
            ? Types_1.WAMessageStubType.CALL_MISSED_GROUP_VIDEO
            : Types_1.WAMessageStubType.CALL_MISSED_GROUP_VOICE
          : a.isVideo
            ? Types_1.WAMessageStubType.CALL_MISSED_VIDEO
            : Types_1.WAMessageStubType.CALL_MISSED_VOICE;
      } else {
        b.message = {
          call: {
            callKey: Buffer.from(a.id),
          },
        };
      }
      b = WAProto_1.proto.WebMessageInfo.fromObject(b);
      G(b, a.offline ? "append" : "notify");
    }
  });
  p.on("connection.update", ({ isOnline: a }) => {
    if (typeof a !== "undefined") {
      I = a;
      m.trace(`sendActiveReceipts set to "${I}"`);
    }
  });
  return {
    ...E,
    sendMessageAck: t,
    sendRetryRequest: R,
    rejectCall: async (a, b) => {
      await M({
        tag: "call",
        attrs: {
          from: k.creds.me.id,
          to: b,
        },
        content: [
          {
            tag: "reject",
            attrs: {
              "call-id": a,
              "call-creator": b,
              count: "0",
            },
            content: undefined,
          },
        ],
      });
    },
    fetchMessageHistory: async (a, b, c) => {
      var d;
      if ((d = k.creds.me) === null || d === undefined || !d.id) {
        throw new boom_1.Boom("Not authenticated");
      }
      return P({
        historySyncOnDemandRequest: {
          chatJid: b.remoteJid,
          oldestMsgFromMe: b.fromMe,
          oldestMsgId: b.id,
          oldestMsgTimestampMs: c,
          onDemandMsgCount: a,
        },
        peerDataOperationRequestType: WAProto_1.proto.Message.PeerDataOperationRequestType.HISTORY_SYNC_ON_DEMAND,
      });
    },
    requestPlaceholderResend: J,
  };
};
exports.makeMessagesRecvSocket = makeMessagesRecvSocket;

