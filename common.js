"use strict";

let path = require("path");
function processOpts(v) {
  if (this.testFnName in v) return v;
  let o = { include: [], exclude: [] };
  if ("include" in v) {
    let tmp = Array.isArray(v.include) ? v.include : [v.include];
    o.include = tmp.map((vv) =>
      vv.constructor.name == "RegExp" ? vv : new RegExp(vv, "i")
    );
  }
  if ("exclude" in v) {
    let tmp = Array.isArray(v.exclude) ? v.exclude : [v.exclude];
    o.exclude = tmp.map((vv) =>
      vv.constructor.name == "RegExp" ? vv : new RegExp(vv, "i")
    );
  }
  // return true if valid for process
  o[this.testFnName] = (url) => {
    let ret = o.include.length ? false : true;

    o.include.forEach((reg) => (ret ||= reg.test(url)));
    o.exclude.forEach((reg) => (ret &&= !reg.test(url)));
    return ret;
  };
  return o;
}
function absRemote(p) {
  p = p.replace(/\/$/, "") || "/";
  return path.join(this.remoteBasePath, p);
}
function absLocal(p) {
  p = p.replace(/\/$/, "") || "/";
  return path.join(this.localBasePath, p);
}
// for SFTP
function formatRights(v) {
  return {
    user: {
      read: v.user.indexOf("r") >= 0 ? true : false,
      write: v.user.indexOf("w") >= 0 ? true : false,
      exec: v.user.indexOf("x") >= 0 ? true : false,
    },
    group: {
      read: v.group.indexOf("r") >= 0 ? true : false,
      write: v.group.indexOf("w") >= 0 ? true : false,
      exec: v.group.indexOf("x") >= 0 ? true : false,
    },
    other: {
      read: v.other.indexOf("r") >= 0 ? true : false,
      write: v.other.indexOf("w") >= 0 ? true : false,
      exec: v.other.indexOf("x") >= 0 ? true : false,
    },
  };
}
// for SFTP
function formatStat(v) {
  return {
    // type: (v.mode >> 15) & 1 ? "-" : "d",
    size: v.size,
    // accessTime: v.accessTime,
    modifyTime: v.modifyTime,
    rights: {
      user: {
        read: (v.mode >> 8) & 1 ? true : false,
        write: (v.mode >> 7) & 1 ? true : false,
        exec: (v.mode >> 6) & 1 ? true : false,
      },
      group: {
        read: (v.mode >> 5) & 1 ? true : false,
        write: (v.mode >> 4) & 1 ? true : false,
        exec: (v.mode >> 3) & 1 ? true : false,
      },
      other: {
        read: (v.mode >> 2) & 1 ? true : false,
        write: (v.mode >> 1) & 1 ? true : false,
        exec: v.mode & 1 ? true : false,
      },
    },
    owner: v.uid,
    group: v.gid,
  };
}
module.exports = { processOpts, absRemote, absLocal, formatRights, formatStat };
