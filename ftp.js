"use strict";

const FTP = function () {
  let fs = require("fs");
  let path = require("path");
  const JSFtp = require("jsftp");
  const noConnectionResponse = {
    err: "No FTP connection available",
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
        vv.constructor.name == "RegExp" ? vv : new RegExp(vv, "gi")
      );
    }
    if ("exclude" in v) {
      let tmp = Array.isArray(v.exclude) ? v.exclude : [v.exclude];
      o.exclude = tmp.map((vv) =>
        vv.constructor.name == "RegExp" ? vv : new RegExp(vv, "gi")
      );
    }
    o[testFnName] = (url) => {
      var ret = o.include.length ? false : true;
      o.include.forEach((reg) => (ret |= reg.test(url)));
      o.exclude.forEach((reg) => (ret &= !reg.test(url)));
      return ret ? true : false;
    };
    return o;
  }
  function formatStat(v) {
    return {
      type: v.type ? "d" : "-",
      name: v.name,
      size: v.size * 1,
      modifyTime: v.time,
      rights: {
        user: v.userPermissions,
        group: v.groupPermissions,
        other: v.otherPermissions,
      },
      owner: v.owner,
      group: v.group,
    };
  }
  async function delDir(destPath, opts = { include: [], exclude: [] }) {
    if (!conn) return noConnectionResponse;
    opts = testFnName in opts ? opts : processOpts(opts);
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
        let delStat = await retObj.del(childDest, opts);
        if (delStat.err) return delStat;
      } else {
        dirChild.push(childDest);
      }
    }
    for (let i = 0; i < dirChild.length; i++) {
      let delStat = await delDir(dirChild[i], opts);
      if (delStat.err) return delStat;
    }
    if (!opts[testFnName](absDestPath)) {
      logger({
        method: "del",
        res: { dest: destPath, res: `skip del ${absDestPath} .` },
        err: null,
      });
      return { res: `skip del ${absDestPath} .`, err: null };
    }
    res = await new Promise((resolve) => {
      conn.raw("rmd", absDestPath, (e) => {
        if (e) return resolve({ err: e.message });
        resolve({ err: null });
      });
    });
    logger({
      method: "del",
      res: { dest: destPath, res: res.res },
      err: res.err,
    });
    return res;
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
    if (!opts[testFnName](absSrcPath)) {
      logger({
        method: "put",
        res: {
          src: srcPath,
          dest: destPath,
          res: `skip put ${absSrcPath} .`,
        },
        err: null,
      });
      return { res: `skip put ${absSrcPath} .`, err: null };
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
        let childPutStat = await retObj.put(childSrc, childDest, opts);
        if (childPutStat.err) return childPutStat;
      }
    }
    for (let i = 0; i < dirChild.length; i++) {
      let childDirPutStat = await putDir(
        dirChild[i].src,
        dirChild[i].dest,
        opts
      );
      if (childDirPutStat.err) return childDirPutStat;
    }
    logger({
      method: "put",
      res: { src: srcPath, dest: destPath },
      err: null,
    });
    return { err: null };
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
    if (!opts[testFnName](absRemotePath)) {
      logger({
        method: "get",
        res: {
          remote: remotePath,
          local: localPath,
          res: `skip get ${absRemotePath} .`,
        },
        err: null,
      });
      return { res: `skip get ${absRemotePath} .`, err: null };
    }
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
        let getStat = await retObj.get(childRemote, childLocal, opts);
        if (getStat.err) return getStat;
      } else {
        dirChild.push({ remote: childRemote, local: childLocal });
      }
    }
    for (let i = 0; i < dirChild.length; i++) {
      let getStat = await getDir(dirChild[i].remote, dirChild[i].local, opts);
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
      let res = await new Promise((resolve) => {
        let _ftp = new JSFtp({ host: cfg.host, port: cfg.port });
        _ftp.auth(cfg.username, cfg.password, (e) => {
          if (e) {
            _ftp.destroy();
            logger({
              method: "connect",
              res: { host: cfg.host },
              err: e.message,
            });
            logger = () => {};
            resolve({ err: e.message });
          } else {
            localBasePath = cfg.localBasePath || "/";
            remoteBasePath = cfg.remoteBasePath || "/";

            logger({
              method: "connect",
              res: { host: cfg.host },
              err: null,
            });
            resolve({ err: null, res: _ftp });
          }
        });
      });
      if (!res.err) {
        conn = res.res;
        return { err: null };
      }
      return res;
    },
    async chmod(
      dest,
      mode,
      recursive = false,
      opts = { include: [], exclude: [] }
    ) {
      if (!conn) return noConnectionResponse;
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
      let res = await new Promise((resolve) => {
        conn.raw("site", "chmod", mode, absDest, (e) => {
          if (e) return resolve({ err: e.message });
          resolve({ err: null });
        });
      });
      if (!res.err && destStat.res == "d" && recursive) {
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
              let chmodStat = await new Promise((resolve) => {
                conn.raw("site", "chmod", mode, absChildDest, (e) => {
                  if (e) return resolve({ err: e.message });
                  resolve({ err: null });
                });
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
      logger({
        method: "chmod",
        res: { dest, mode, recursive, res: res.res },
        err: res.err,
      });
      return res;
    },
    async del(dest, opts = { include: [], exclude: [] }) {
      if (!conn) return noConnectionResponse;
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
      let res = await new Promise((resolve) => {
        conn.raw("dele", absDest, (e) => {
          if (e) return resolve({ err: e.message });

          resolve({ err: null });
        });
      });
      logger({
        method: "del",
        res: { dest, res: res.res },
        err: res.err,
      });
      return res;
    },
    async put(src, dest, opts = { include: [], exclude: [] }) {
      if (!conn) return noConnectionResponse;
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
      let res = await new Promise((resolve) => {
        let srcDat = fs.readFileSync(absSrc);
        conn.put(srcDat, absDest, (e) => {
          if (e) return resolve({ err: e.message });
          return resolve({ err: null });
        });
      });
      logger({
        method: "putx",
        res: { src, dest, res: res.res, ex: opts.exclude },
        err: res.err,
      });
      return res;
    },
    async get(remote, local, opts = { include: [], exclude: [] }) {
      if (!conn) return noConnectionResponse;
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
      let res = await new Promise((resolve) => {
        conn.get(absRemote, (e, socket) => {
          if (e) {
            return resolve({ err: e.message });
          }
          try {
            fs.mkdirSync(path.dirname(absLocal), { recursive: true });
          } catch (err) {
            return resolve({ err: err.message });
          }

          const writeStream = fs.createWriteStream(absLocal);
          writeStream.on("error", (err) => {
            socket.destroy();
            return resolve({ err: err.message });
          });
          socket.on("close", (err) => {
            if (err) {
              logger({
                method: "get",
                res: { remote, local },
                err: e.message,
              });
              return resolve({ err: err.message });
            }
            return resolve({ err: null });
          });
          socket.pipe(writeStream);
        });
      });
      logger({
        method: "get",
        res: { remote, local, res: res.res },
        err: res.err,
      });
      return res;
    },
    async rename(destSrc, dest) {
      if (!conn) return noConnectionResponse;
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
      let res = await new Promise((resolve) => {
        conn.rename(absDestSrc, absDest, (e, r) => {
          if (e) {
            return resolve({ err: e.message });
          }
          return resolve({ err: null });
        });
      });
      logger({
        method: "rename",
        res: { destSrc, dest, res: res.res },
        err: res.err,
      });
      return res;
    },
    async mkDir(destPath) {
      if (!conn) return noConnectionResponse;
      destPath = destPath.replace(/\/$/, "") || "/";
      let absDest = path.join(remoteBasePath, destPath);
      let res = await new Promise((resolve) => {
        conn.raw("cwd", absDest, async (e) => {
          if (e) {
            let paths = absDest.split("/"),
              idx = paths.length - 1,
              isOk = false;
            while (idx > 0 && !isOk) {
              let partPath = paths.slice(0, idx).join("/") || "/";

              let partExists = await this.exists(
                path.relative(remoteBasePath, partPath)
              );
              if (partExists.err) return resolve(partExists);
              if (partExists.res === "d") isOk = true;
              else idx--;
            }
            if (!isOk)
              return resolve({
                err: `Can not create directory ${absDest} .`,
              });
            while (idx < paths.length) {
              let partPath = paths.slice(0, ++idx).join("/") || "/";
              let partCreate = await new Promise((resolve) => {
                conn.raw("mkd", partPath, (e) => {
                  if (e) {
                    return resolve({ err: e.message });
                  }
                  resolve({ err: null });
                });
              });
              if (partCreate.err) return resolve(partCreate);
            }
            resolve({ err: null });
          } else {
            resolve({ err: null });
          }
        });
      });
      logger({
        method: "mkDir",
        res: { destPath, res: res.res },
        err: res.err,
      });
      return res;
    },
    async list(destPath) {
      if (!conn) return noConnectionResponse;
      destPath = destPath.replace(/\/$/, "") || "/";
      let absDest = path.join(remoteBasePath, destPath);
      let res = await new Promise((resolve) => {
        conn.ls(absDest, (e, data) => {
          if (e) return resolve({ err: e.message });

          if (data.length == 1 && data[0].name == absDest)
            return resolve({
              err: `${absDest} is not a directory.`,
            });

          data = data.map((v) => formatStat(v));

          return resolve({ err: null, res: data });
        });
      });
      logger({
        method: "list",
        res: { destPath, res: res.res },
        err: res.err,
      });
      return res;
    },
    async stat(dest) {
      if (!conn) return noConnectionResponse;
      dest = dest.replace(/\/$/, "") || "/";
      let absDest = path.join(remoteBasePath, dest);
      let res = await new Promise((resolve) => {
        conn.ls(absDest, async (e, data) => {
          if (e) return resolve({ err: e.message });

          // it's a file , return stat
          if (data.length == 1 && data[0].name == absDest)
            return resolve({
              err: null,
              res: Object.assign(formatStat(data[0]), {
                name: data[0].name.replace(/\/$/, "").replace(/^.*[\\\/]/, ""),
              }),
            });

          // it's a directory retrieve parent's directory list and return target directory info
          let dirName = dest.replace(/^.*[\\\/]/, ""),
            upperDirList = await this.list(
              dest.split("/").slice(0, -1).join("/")
            );
          if (upperDirList.err) return upperDirList;

          let o = upperDirList.res.find((v) => v.name == dirName);
          if (o) return resolve({ err: null, res: o });

          return resolve({
            err: `Error retrive stat for ${dest}`,
          });
        });
      });
      logger({
        method: "stat",
        res: { dest, res: res.res },
        err: res.err,
      });
      return res;
    },
    async exists(dest) {
      if (!conn) return noConnectionResponse;
      dest = dest.replace(/\/$/, "") || "/";
      let absDest = path.join(remoteBasePath, dest);
      let res = await new Promise((resolve) => {
        conn.ls(absDest, (e, data) => {
          if (e) {
            if (e.message.indexOf("450 ") == 0)
              return resolve({ err: null, res: false });
            return resolve({ err: e.message });
          }
          if (data.length == 1 && data[0].name == absDest)
            return resolve({ err: null, res: "-" });
          return resolve({ err: null, res: "d" });
        });
      });
      logger({
        method: "exists",
        res: { dest, res: res.res },
        err: res.err,
      });
      return res;
    },
    async quit() {
      if (!conn) return noConnectionResponse;
      return await new Promise((resolve) => {
        conn.raw("quit", (e, data) => {
          if (e) {
            logger({
              method: "quit",
              err: e.message,
            });
            return resolve({ err: e.message });
          }
          conn = null;
          logger({
            method: "quit",
            err: null,
          });
          logger = () => {};
          resolve({ err: null });
        });
      });
    },
  };
  return retObj;
};
module.exports = FTP;
