"use strict";
const SFTP = function () {
  let fs = require("fs");
  let path = require("path");
  const Client = require("ssh2-sftp-client");
  const noConnectionResponse = {
    err: "No SFTP connection available",
  };
  let testFnName = Math.random().toString(36).replace("0.", "_");
  let conn,
    logger = () => {},
    localBasePath = "/",
    remoteBasePath = "/";
  function processOpts(v) {
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
    o[testFnName] = (url) => {
      let ret = o.include.length ? false : true;

      o.include.forEach((reg) => (ret ||= reg.test(url)));
      o.exclude.forEach((reg) => (ret &&= !reg.test(url)));
      return ret;
    };
    return o;
  }
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
  async function remoteListRecursive(
    remotePath,
    opts = { include: [], exclude: [] }
  ) {
    if (!conn) return noConnectionResponse;
    remotePath = remotePath.replace(/\/$/, "") || "/";
    opts = testFnName in opts ? opts : processOpts(opts);
    let res = [],
      absRemotePath = path.join(localBasePath, remotePath);

    let tmp = await retObj.list(remotePath);
    if (tmp.err) return tmp;

    let remoteFiles = tmp.res,
      dirChild = [];
    for (let i = 0; i < remoteFiles.length; i++) {
      let childRemote = path.join(remotePath, remoteFiles[i].name),
        childAbsRemote = path.join(localBasePath, childRemote);
      if (remoteFiles[i].type == "-") {
        if (opts[testFnName](childAbsRemote))
          res.push({ type: "-", url: childAbsRemote });
      } else {
        dirChild.push(childRemote);
      }
    }
    for (let i = 0; i < dirChild.length; i++) {
      let childDirRes = await remoteListRecursive(dirChild[i], opts);
      if (!childDirRes.err && childDirRes.res.length) {
        res.push({
          type: "d",
          url: path.join(localBasePath, dirChild[i]),
          child: childDirRes.res,
        });
      }
    }
    return { err: null, res };
  }
  async function localListRecursive(
    localPath,
    opts = { include: [], exclude: [] }
  ) {
    if (!conn) return noConnectionResponse;
    localPath = localPath.replace(/\/$/, "") || "/";
    opts = testFnName in opts ? opts : processOpts(opts);
    let res = [],
      absLocalPath = path.join(localBasePath, localPath);

    if (!fs.existsSync(absLocalPath))
      return { err: `No source directory ${absLocalPath} .` };

    if (!fs.lstatSync(absLocalPath).isDirectory())
      return { err: `${absLocalPath} is not a directory.` };

    let localFiles = fs.readdirSync(absLocalPath),
      dirChild = [];
    for (let i = 0; i < localFiles.length; i++) {
      let childLocal = path.join(localPath, localFiles[i]),
        childAbsLocal = path.join(localBasePath, childLocal),
        childStat = fs.lstatSync(childAbsLocal);
      if (childStat.isDirectory()) dirChild.push(childLocal);
      if (childStat.isFile()) {
        console.warn("test ", childAbsLocal);
        if (opts[testFnName](childAbsLocal))
          res.push({ type: "-", url: childAbsLocal });
      }
    }
    for (let i = 0; i < dirChild.length; i++) {
      let childDirRes = await localListRecursive(dirChild[i], opts);
      if (!childDirRes.err && childDirRes.res.length) {
        res.push({
          type: "d",
          url: path.join(localBasePath, dirChild[i]),
          child: childDirRes.res,
        });
      }
    }
    return { err: null, res };
  }
  async function doDelDir(files) {
    let errs = [];
    for (let i = 0; i < files.length; i++) {
      if (files[i].type == "-") {
        let res = await conn
          .delete(files[i].url, true)
          .then((r) => {
            return { err: null };
          })
          .catch((e) => {
            return { err: e.message };
          });
        errs.push(res.err);
        logger({
          method: "del",
          res: { dest, res: res.res },
          err: res.err,
        });
      } else {
        errs = [...errs, ...(await doDelDir(files[i].child))];
        let res = await conn
          .rmdir(files[i].url)
          .then((r) => {
            return { err: null };
          })
          .catch((e) => {
            return { err: e.message };
          });
        // errs.push(res.err);
        logger({
          method: "del",
          res: { dest: destPath, res: res.res },
          err: res.err,
        });
      }
    }
    return errs;
  }
  async function delDir(destPath, opts = { include: [], exclude: [] }) {
    if (!conn) return noConnectionResponse;
    opts = testFnName in opts ? opts : processOpts(opts);
    destPath = destPath.replace(/\/$/, "") || "/";
    let stat = await remoteListRecursive(destPath, opts);
    if (stat.err) return stat;
    let err = (await doDelDir(stat.res)).filter((v) => v).join("/n");
    if (err) return { err };
    let res = await conn
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
    return { err: null };
    // maybe some child exists by include/exclude , so report no error
    return res;
  }
  async function doPutDir(absSrcPath, absDestPath, files) {
    let errs = [];
    let res = await conn
      .mkdir(absDestPath, true)
      .then((r) => {
        return { err: null };
      })
      .catch(async (e) => {
        let r = await conn
          .exists(absDestPath)
          .then((r) => {
            return { err: null, res: r };
          })
          .catch((e) => {
            return { err: e.message };
          });
        if (!res.err && res.res == "d") return { err: null };
        return { err: e.message };
      });
    if (res.err) return [res.err];
    for (let i = 0; i < files.length; i++) {
      if (files[i].type == "-") {
        let d = fs.createReadStream(absSrc);
        let res = await conn
          .put(d, absDest)
          .then((r) => {
            return { err: null };
          })
          .catch((e) => {
            return { err: e.message };
          });

        errs.push(res.err);
        logger({
          method: "put",
          res: { src, dest, res: res.res, opts },
          err: res.err,
        });
      } else {
        errs = [
          ...errs,
          ...(await doPutDir(
            files[i].url,
            path.join(absDestPath, path.relative(absSrcPath, files[i].url)),
            files[i].child
          )),
        ];
      }
    }
    return errs;
  }
  async function putDir(
    srcPath,
    destPath,
    opts = { include: [], exclude: [] }
  ) {
    if (!conn) return noConnectionResponse;
    opts = testFnName in opts ? opts : processOpts(opts);
    srcPath = srcPath.replace(/\/$/, "") || "/";
    destPath = destPath.replace(/\/$/, "") || "/";
    let absSrcPath = path.join(localBasePath, srcPath);
    let absDestPath = path.join(remoteBasePath, destPath);
    let destStat = await retObj.exists(destPath);
    if (destStat.err) {
      logger({
        method: "put",
        res: { src: srcPath, dest: destPath },
        err: destStat.err,
      });
      return destStat;
    }
    let stat = await localListRecursive(srcPath, opts);
    if (stat.err) return stat;
    let err = (await doPutDir(absSrcPath, absDestPath, stat.res))
      .filter((v) => v)
      .join("/n");
    if (err) return { err };
  }
  async function doGetDir(absRemotePath, absLocalPath, files) {
    let errs = [];
    let res = await new Promise((resolve) => {
      if (!fs.existsSync(absLocalPath))
        try {
          fs.mkdirSync(absLocalPath, { recursive: true });
        } catch (e) {
          logger({
            method: "get",
            res: {
              remote: path.relative(remoteBasePath, remotePath),
              local: path.relative(localBasePath, localPath),
            },
            err: e.message,
          });
          resolve({ err: e.message });
        }
      if (!fs.lstatSync(absLocalPath).isDirectory()) {
        logger({
          method: "get",
          res: {
            remote: path.relative(remoteBasePath, remotePath),
            local: path.relative(localBasePath, localPath),
          },
          err: null,
        });
        resolve({ err: `${absLocalPath} is not a directory.` });
      }
    });
    if (res.err) return [res.err];
    for (let i = 0; i < files.length; i++) {
      if (files[i].type == "-") {
        let res = await new Promise(async (resolve) => {
          let absLocal = path.join(
            absLocalPath,
            path.relative(absRemotePath, files[i].url)
          );
          let res = await conn
            .get(files[0].url, absLocal)
            .then((r) => {
              return { err: null };
            })
            .catch((e) => {
              return { err: e.message };
            });
        });
        errs.push(res.err);
        logger({
          method: "get",
          res: { absRemotePath, absLocalPath, opts },
          err: res.err,
        });
      } else {
      }
    }
    return errs;
  }
  async function getDir(
    remotePath,
    localPath,
    opts = { include: [], exclude: [] }
  ) {
    if (!conn) return noConnectionResponse;
    opts = testFnName in opts ? opts : processOpts(opts);
    localPath = localPath.replace(/\/$/, "") || "/";
    remotePath = remotePath.replace(/\/$/, "") || "/";
    let absLocalPath = path.join(localBasePath, localPath),
      absRemotePath = path.join(remoteBasePath, remotePath);
    let stat = await remoteListRecursive(remotePath, opts);
    if (stat.err) return stat;
    let err = (await doGetDir(absRemotePath, absLocalPath, stat.res))
      .filter((v) => v)
      .join("/n");
    if (err) return { err };
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
    async chmod(
      dest,
      mode,
      recursive = false,
      opts = { include: [], exclude: [] }
    ) {
      if (!conn || !conn.sftp) return noConnectionResponse;
      opts = testFnName in opts ? opts : processOpts(opts);
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
      if (!opts[testFnName](absDest)) {
        logger({
          method: "chmod",
          res: { dest, mode, recursive, res: `skip chmod ${absDest} .` },
          err: null,
        });
        return { res: `skip chmod ${absDest} .`, err: null };
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
                if (!opts[testFnName](absChildDest)) {
                  logger({
                    method: "chmod",
                    res: {
                      dest,
                      mode,
                      recursive,
                      res: `skip chmod ${absChildDest} .`,
                    },
                    err: null,
                  });
                  //return { res: `skip chmod ${absChildDest} .`, err: null };
                } else {
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
                }
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
    async del(dest, opts = { include: [], exclude: [] }) {
      if (!conn || !conn.sftp) return noConnectionResponse;
      opts = testFnName in opts ? opts : processOpts(opts);
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
      if (destStat.res == "d") return await delDir(dest, opts);
      if (!opts[testFnName](absDest)) {
        logger({
          method: "del",
          res: { dest, res: `skip del ${absDest} .` },
          err: null,
        });
        return { res: `skip del ${absDest} .`, err: null };
      }
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
    async put(src, dest, opts = { include: [], exclude: [] }) {
      if (!conn || !conn.sftp) return noConnectionResponse;
      opts = testFnName in opts ? opts : processOpts(opts);
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
      if (fs.lstatSync(absSrc).isDirectory())
        return await putDir(src, dest, opts);
      if (!opts[testFnName](absSrc)) {
        logger({
          method: "put",
          res: { src, dest, res: `skip put ${absSrc} .` },
          err: null,
        });
        return { res: `skip put ${absSrc} .`, err: null };
      }
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
    async get(remote, local, opts = { include: [], exclude: [] }) {
      if (!conn || !conn.sftp) return noConnectionResponse;
      opts = testFnName in opts ? opts : processOpts(opts);
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
      if (destStat.res == "d") return await getDir(remote, local, opts);
      if (!opts[testFnName](absRemote)) {
        logger({
          method: "get",
          res: { remote, local, res: `skip get ${absRemote} .` },
          err: null,
        });
        return { res: `skip get ${absRemote} .`, err: null };
      }
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
