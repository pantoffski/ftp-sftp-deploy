"use strict";

const { timeStamp } = require("console");

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
        let res = await new Promise((resolve) => {
          conn.raw("dele", files[i].url, (e) => {
            if (e) return resolve({ err: e.message });
            resolve({ err: null });
          });
        });
        errs.push(res.err);
        logger({
          method: "del",
          res: { res: res.res },
          err: res.err,
        });
      } else {
        errs = [...errs, ...(await doDelDir(files[i].child))];
        let res = await new Promise((resolve) => {
          conn.raw("rmd", files[i].url, (e) => {
            if (e) return resolve({ err: e.message });
            resolve({ err: null });
          });
        });
        // errs.push(res.err);
        logger({
          method: "del",
          res: { res: res.res },
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
    let res = await new Promise((resolve) => {
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
    return { err: null };
    // maybe some child exists by include/exclude , so report no error
    return res;
  }
  async function mkDirAbs(absDest) {
    return await new Promise((resolve) => {
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
  }
  async function doPutDir(absSrcPath, absDestPath, files) {
    let errs = [];
    let res = await mkDirAbs(absDestPath);
    if (res.err) return [res.err];
    for (let i = 0; i < files.length; i++) {
      if (files[i].type == "-") {
        let res = await new Promise((resolve) => {
          console.log("read file sync", files[i].url, files[i].type);

          let srcDat = fs.readFileSync(files[i].url);
          conn.put(
            srcDat,
            path.join(absDestPath, path.relative(absSrcPath, files[i].url)),
            (e) => {
              if (e) return resolve({ err: e.message });
              return resolve({ err: null });
            }
          );
        });
        errs.push(res.err);
        logger({
          method: "put",
          res: { res: res.res },
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
    console.log(JSON.stringify(stat));

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
        let res = await new Promise((resolve) => {
          let absLocal = path.join(
            absLocalPath,
            path.relative(absRemotePath, files[i].url)
          );
          conn.get(files[0].url, (e, socket) => {
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
                  res: { absRemotePath, absLocalPath, opts },
                  err: e.message,
                });
                return resolve({ err: err.message });
              }
              return resolve({ err: null });
            });
            socket.pipe(writeStream);
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
    async listLocal(localPath, opts = { include: [], exclude: [] }) {
      return await localListRecursive(localPath, opts);
    },
    async listRemote(remotePath, opts = { include: [], exclude: [] }) {
      return await remoteListRecursive(remotePath, opts);
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
        method: "put",
        res: { src, dest, res: res.res, opts },
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
      let res = await mkDirAbs(absDest);
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
