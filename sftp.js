"use strict";
const SFTP = function () {
  let fs = require("fs");
  let path = require("path");
  const Client = require("ssh2-sftp-client");
  const noConnectionResponse = {
    err: "No SFTP connection available",
  };
  let conn,
    logger = () => {},
    localBasePath = "/",
    remoteBasePath = "/";

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
  async function delDir(destPath) {
    if (!conn || !conn.sftp) return noConnectionResponse;
    destPath = destPath.replace(/\/$/, "") || "/";
    let absDestPath = path.join(remoteBasePath, destPath);
    let destStat = await retObj.exists(destPath);
    if (destStat.err) {
      logger({
        method: "del",
        res: { dest: destPath, res: res.res },
        err: destStat.err,
      });
      return destStat;
    }
    if (destStat.res != "d") {
      logger({
        method: "del",
        res: { dest: destPath, res: res.res },
        err: `${absDestPath} is not a directory.`,
      });
      return { err: `${absDestPath} is not a directory.` };
    }
    let res = await retObj.list(destPath);
    if (res.err) {
      logger({
        method: "del",
        res: { dest: destPath, res: res.res },
        err: res.err,
      });
      return res;
    }
    let destFiles = res.res;
    let dirChild = [];
    for (let i = 0; i < destFiles.length; i++) {
      let childDest = path.join(destPath, destFiles[i].name);
      if (destFiles[i].type == "-") {
        let delStat = await retObj.del(childDest);
        if (delStat.err) return delStat;
      } else {
        dirChild.push(childDest);
      }
    }
    for (let i = 0; i < dirChild.length; i++) {
      let delStat = await delDir(dirChild[i]);
      if (delStat.err) return delStat;
    }
    res = await conn
      .rmdir(absDestPath)
      .then((r) => {
        return { err: null };
      })
      .catch((e) => {
        return { err: e.message };
      });

    logger({
      method: "del",
      res: { dest: destPath, res: res.res },
      err: res.err,
    });
    return res;
  }
  async function putDir(srcPath, destPath) {
    if (!conn || !conn.sftp) return noConnectionResponse;
    srcPath = srcPath.replace(/\/$/, "") || "/";
    destPath = destPath.replace(/\/$/, "") || "/";
    let absSrcPath = path.join(localBasePath, srcPath);
    let absDestPath = path.join(remoteBasePath, destPath);
    if (!fs.existsSync(absSrcPath)) {
      logger({
        method: "put",
        res: { src: srcPath, dest: destPath },
        err: `No source directory ${absSrcPath} .`,
      });
      return { err: `No source directory ${absSrcPath} .` };
    }
    if (!fs.lstatSync(absSrcPath).isDirectory()) {
      logger({
        method: "put",
        res: { src: srcPath, dest: destPath },
        err: `${absSrcPath} is not a directory.`,
      });
      return { err: `${absSrcPath} is not a directory.` };
    }
    let destStat = await retObj.exists(destPath);
    if (destStat.err) {
      logger({
        method: "put",
        res: { src: srcPath, dest: destPath },
        err: destStat.err,
      });
      return destStat;
    }
    if (destStat.res == "-") {
      logger({
        method: "put",
        res: { src: srcPath, dest: destPath },
        err: `${absDestPath} is not a directory.`,
      });
      return { err: `${absDestPath} is not a directory.` };
    }
    let mkDirStat = await retObj.mkDir(destPath);
    if (mkDirStat.err) {
      logger({
        method: "put",
        res: { src: srcPath, dest: destPath },
        err: mkDirStat.err,
      });
      return mkDirStat;
    }
    let srcFiles = fs.readdirSync(absSrcPath),
      dirChild = [];
    for (let i = 0; i < srcFiles.length; i++) {
      let childSrc = path.join(srcPath, srcFiles[i]),
        childAbsSrc = path.join(localBasePath, childSrc),
        childDest = path.join(destPath, srcFiles[i]),
        childStat = fs.lstatSync(childAbsSrc);
      if (childStat.isDirectory())
        dirChild.push({
          src: childSrc,
          dest: childDest,
        });
      if (childStat.isFile) {
        let childPutStat = await retObj.put(childSrc, childDest);
        if (childPutStat.err) return childPutStat;
      }
    }
    for (let i = 0; i < dirChild.length; i++) {
      let childDirPutStat = await putDir(dirChild[i].src, dirChild[i].dest);
      if (childDirPutStat.err) return childDirPutStat;
    }
    logger({
      method: "put",
      res: { src: srcPath, dest: destPath },
      err: null,
    });
    return { err: null };
  }
  async function getDir(remotePath, localPath) {
    if (!conn || !conn.sftp) return noConnectionResponse;
    localPath = localPath.replace(/\/$/, "") || "/";
    remotePath = remotePath.replace(/\/$/, "") || "/";
    let absLocalPath = path.join(localBasePath, localPath);
    if (!fs.existsSync(absLocalPath))
      try {
        fs.mkdirSync(absLocalPath, { recursive: true });
      } catch (e) {
        logger({
          method: "get",
          res: { remote: remotePath, local: localPath },
          err: e.message,
        });
        return { err: e.message };
      }
    if (!fs.lstatSync(absLocalPath).isDirectory()) {
      logger({
        method: "get",
        res: { remote: remotePath, local: localPath },
        err: null,
      });
      return { err: `${absLocalPath} is not a directory.` };
    }
    let res = await retObj.list(remotePath);
    if (res.err) {
      logger({
        method: "get",
        res: { remote: remotePath, local: localPath },
        err: res.err,
      });
      return res;
    }
    let remoteFiles = res.res,
      dirChild = [];

    for (let i = 0; i < remoteFiles.length; i++) {
      let childRemote = path.join(remotePath, remoteFiles[i].name),
        childLocal = path.join(localPath, remoteFiles[i].name);
      if (remoteFiles[i].type == "-") {
        let getStat = await retObj.get(childRemote, childLocal);
        if (getStat.err) return getStat;
      } else {
        dirChild.push({ remote: childRemote, local: childLocal });
      }
    }
    for (let i = 0; i < dirChild.length; i++) {
      let getStat = await getDir(dirChild[i].remote, dirChild[i].local);
      if (getStat.err) return getStat;
    }
    logger({
      method: "get",
      res: { remote: remotePath, local: localPath },
      err: null,
    });
    return { err: null };
  }
  const retObj = {
    async connect(cfg) {
      if (typeof cfg.logger == "function") logger = cfg.logger;
      if (!conn) conn = new Client();
      return await conn
        .connect(cfg)
        .then((r) => {
          localBasePath = cfg.localBasePath || "/";
          remoteBasePath = cfg.remoteBasePath || "/";
          logger({
            method: "connect",
            res: { host: cfg.host },
            err: e.message,
          });
          return { err: null, res: conn };
        })
        .catch((e) => {
          logger({
            method: "connect",
            res: { host: cfg.host },
            err: null,
          });
          logger = () => {};
          return { err: e.message };
        });
    },
    async chmod(dest, mode, recursive = false) {
      if (!conn || !conn.sftp) return noConnectionResponse;
      dest = dest.replace(/\/$/, "") || "/";
      let absDest = path.join(remoteBasePath, dest);
      let destStat = await this.exists(dest);
      if (destStat.err || !destStat.res) {
        logger({
          method: "chmod",
          res: { dest, mode, recursive },
          err: destStat.err,
        });
        return destStat;
      }
      let res = await conn
        .chmod(absDest, parseInt(mode + "", 8))
        .then(async (r) => {
          if (recursive && destStat.res == "d") {
            let res = await this.list(dest);
            if (res.err) return res;
            let destFiles = res.res;
            let dirChild = [];
            for (let i = 0; i < destFiles.length; i++) {
              let childDest = path.join(dest, destFiles[i].name);
              let absChildDest = path.join(remoteBasePath, childDest);
              if (destFiles[i].type == "-") {
                let chmodStat = await conn
                  .chmod(absChildDest, parseInt(mode + "", 8))
                  .then((r) => {
                    return {
                      err: null,
                    };
                  })
                  .catch((e) => {
                    return {
                      err: e.message,
                    };
                  });
                logger({
                  method: "chmod",
                  res: { childDest, mode, recursive, res: chmodStat.res },
                  err: chmodStat.err,
                });
                if (chmodStat.err) return chmodStat;
              } else {
                dirChild.push(childDest);
              }
            }
            for (let i = 0; i < dirChild.length; i++) {
              let chmodStat = await this.chmod(dirChild[i], mode, recursive);
              if (chmodStat.err) return chmodStat;
            }
          }
          return { err: null };
        })
        .catch((e) => {
          return { err: e.message };
        });
      logger({
        method: "chmod",
        res: { dest, mode, recursive, res: res.res },
        err: res.err,
      });
      return res;
    },
    async del(dest) {
      if (!conn || !conn.sftp) return noConnectionResponse;
      dest = dest.replace(/\/$/, "") || "/";
      let absDest = path.join(remoteBasePath, dest);
      let destStat = await this.exists(dest);
      if (destStat.err || !destStat.res) {
        logger({
          method: "del",
          res: { dest },
          err: `${dest} not found.`,
        });
        return Object.assign(destStat, { err: `${dest} not found.` });
      }
      if (destStat.res == "d") return await delDir(dest);
      let res = await conn
        .delete(absDest, true)
        .then((r) => {
          return { err: null };
        })
        .catch((e) => {
          return { err: e.message };
        });
      logger({
        method: "del",
        res: { dest, res: res.res },
        err: res.err,
      });
      return res;
    },
    async put(src, dest) {
      if (!conn || !conn.sftp) return noConnectionResponse;
      src = src.replace(/\/$/, "") || "/";
      dest = dest.replace(/\/$/, "") || "/";
      let absSrc = path.join(localBasePath, src);
      let absDest = path.join(remoteBasePath, dest);
      if (!fs.existsSync(absSrc)) {
        logger({
          method: "put",
          res: { src, dest },
          err: `No source file or directory ${absSrc} .`,
        });
        return { err: `No source file or directory ${absSrc} .` };
      }
      if (fs.lstatSync(absSrc).isDirectory()) return await putDir(src, dest);
      let destPath = dest.split("/").slice(0, -1).join("/");
      let mkDirRes = await this.mkDir(destPath).catch((e) => {
        return { err: e.message };
      });
      if (mkDirRes.err) {
        logger({
          method: "put",
          res: { src, dest },
          err: mkDirRes.err,
        });
        return mkDirRes;
      }
      let d = fs.createReadStream(absSrc);
      let res = await conn
        .put(d, absDest)
        .then((r) => {
          return { err: null };
        })
        .catch((e) => {
          return { err: e.message };
        });
      logger({
        method: "put",
        res: { src, dest, res: res.res },
        err: res.err,
      });
      return res;
    },
    async get(remote, local) {
      if (!conn || !conn.sftp) return noConnectionResponse;
      remote = remote.replace(/\/$/, "") || "/";
      local = local.replace(/\/$/, "") || "/";
      let absRemote = path.join(remoteBasePath, remote);
      let absLocal = path.join(localBasePath, local);
      let destStat = await this.exists(remote);
      if (destStat.err || !destStat.res) {
        logger({
          method: "get",
          res: { remote, local },
          err: `${absRemote} not found.`,
        });
        return Object.assign(destStat, { err: `${absRemote} not found.` });
      }
      if (destStat.res == "d") return await getDir(remote, local);
      try {
        fs.mkdirSync(path.dirname(absLocal), { recursive: true });
      } catch (err) {
        logger({
          method: "get",
          res: { remote, local },
          err: e.message,
        });
        return resolve({ err: err.message });
      }
      let res = await conn
        .get(absRemote, absLocal)
        .then((r) => {
          return { err: null };
        })
        .catch((e) => {
          return { err: e.message };
        });
      logger({
        method: "get",
        res: { remote, local, res: res.res },
        err: res.err,
      });
      return res;
    },
    async rename(destSrc, dest) {
      if (!conn || !conn.sftp) return noConnectionResponse;
      destSrc = destSrc.replace(/\/$/, "") || "/";
      let absDestSrc = path.join(remoteBasePath, destSrc);
      let absDest = path.join(remoteBasePath, dest);
      let destStat = await this.exists(destSrc);
      if (destStat.err || !destStat.res) {
        logger({
          method: "rename",
          res: { destSrc, dest },
          err: `${absDestSrc} not found.`,
        });
        return Object.assign(destStat, { err: `${absDestSrc} not found.` });
      }
      let res = await conn
        .rename(absDestSrc, absDest)
        .then((r) => {
          return { err: null };
        })
        .catch(async (e) => {
          return { err: e.message };
        });
      logger({
        method: "rename",
        res: { destSrc, dest, res: res.res },
        err: res.err,
      });
      return res;
    },

    async mkDir(destPath) {
      if (!conn || !conn.sftp) return noConnectionResponse;
      destPath = destPath.replace(/\/$/, "") || "/";
      let absDest = path.join(remoteBasePath, destPath);
      if ((await this.exists(destPath)).res == "d") {
        logger({
          method: "mkDir",
          res: { destPath, res: `${destPath} already exists.` },
          err: null,
        });
        return { err: null };
      }
      let res = await conn
        .mkdir(absDest, true)
        .then((r) => {
          return { err: null };
        })
        .catch(async (e) => {
          let res = await this.exists(destPath);
          if (!res.err && res.res == "d") return { err: null };
          return { err: e.message };
        });
      logger({
        method: "mkDir",
        res: { destPath, res: res.res },
        err: res.err,
      });
      return res;
    },
    async list(destPath) {
      if (!conn || !conn.sftp) return noConnectionResponse;
      destPath = destPath.replace(/\/$/, "") || "/";
      let absDest = path.join(remoteBasePath, destPath);
      if ((await this.exists(destPath)).res != "d") {
        logger({
          method: "list",
          res: { destPath },
          err: `${absDest} is not a directory.`,
        });
        return { err: `${absDest} is not a directory.` };
      }
      let res = await conn
        .list(absDest)
        .then((r) => {
          r.forEach((v) => (v.rights = formatRights(v.rights)));
          return { err: null, res: r };
        })
        .catch((e) => {
          return { err: e.message };
        });
      logger({
        method: "list",
        res: { destPath, res: res.res },
        err: res.err,
      });
      return res;
    },
    async stat(dest) {
      if (!conn || !conn.sftp) return noConnectionResponse;
      dest = dest.replace(/\/$/, "") || "/";
      let absDest = path.join(remoteBasePath, dest);
      let res = await conn
        .stat(absDest)
        .then(async (r) => {
          let res = await this.exists(dest);
          if (res.err || !res.res) return res;
          return {
            err: null,
            res: Object.assign(
              {
                name: dest.replace(/\/$/, "").replace(/^.*[\\\/]/, ""),
                type: res.res,
              },
              formatStat(r)
            ),
          };
        })
        .catch((e) => {
          return { err: e.message };
        });
      logger({
        method: "stat",
        res: { dest, res: res.res },
        err: res.err,
      });
      return res;
    },
    async exists(dest) {
      if (!conn || !conn.sftp) return noConnectionResponse;
      dest = dest.replace(/\/$/, "") || "/";
      let absDest = path.join(remoteBasePath, dest);
      try {
        let r = await conn.exists(absDest);
        logger({
          method: "exists",
          res: { dest, res: r },
          err: e.message,
        });
        return { err: null, res: r };
      } catch (e) {
        logger({
          method: "exists",
          res: { dest },
          err: e.message,
        });
        return { err: e.message };
      }
    },
    async quit() {
      if (!conn || !conn.sftp) return noConnectionResponse;
      return await conn
        .end()
        .then((r) => {
          conn = null;
          logger({
            method: "quit",
            err: null,
          });
          logger = () => {};
          return { err: null };
        })
        .catch((e) => {
          logger({
            method: "quit",
            err: e.message,
          });
          return { err: e.message };
        });
    },
  };
  return retObj;
};
module.exports = SFTP;
