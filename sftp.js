"use strict";
const { formatRights, formatStat } = require("./common");
const { timeStamp } = require("console");
let fs = require("fs");
let path = require("path");
const Client = require("ssh2-sftp-client");
function hello() {
  console.log(`hola ${this.name}`);
}
async function connect(cfg) {
  console.log("connect fn");

  if (typeof cfg.logger == "function") this.logger = cfg.logger;
  if (!this.conn) this.conn = new Client();
  return await this.conn
    .connect(cfg)
    .then((r) => {
      this.localBasePath = cfg.localBasePath || "/";
      this.remoteBasePath = cfg.remoteBasePath || "/";
      this.logger({
        method: "connect",
        res: `connected to ${cfg.host}`,
        err: null,
      });
      return { err: null, res: this.conn };
    })
    .catch((e) => {
      this.logger({
        method: "connect",
        res: `error connecting to ${cfg.host}`,
        err: e.message,
      });
      this.logger = () => {};
      return { err: e.message };
    });
}
async function quit() {
  if (this.noConnection()) return this.noConnectionResponse;
  return await this.conn
    .end()
    .then((r) => {
      this.conn = null;
      this.logger({
        method: "quit",
        res: `connection ended`,
        err: null,
      });
      this.logger = () => {};
      return { err: null };
    })
    .catch((e) => {
      this.logger({
        method: "quit",
        res: `error ending connection`,
        err: e.message,
      });
      return { err: e.message };
    });
}
/**
 * @returns {boolean|string} false if not exists , 'd' -> directory , '-' -> file
 */
async function exists(dest) {
  if (this.noConnection()) return this.noConnectionResponse;
  let absDest = this.absRemote(dest);
  try {
    let r = await this.conn.exists(absDest);
    this.logger({
      method: "exists",
      res: `${absDest} exists`,
      err: null,
    });
    return { err: null, res: r };
  } catch (e) {
    this.logger({
      method: "exists",
      res: `error calling 'exist' function for ${absDest}`,
      err: e.message,
    });
    return { err: e.message };
  }
}
async function stat(dest) {
  if (this.noConnection()) return this.noConnectionResponse;
  let absDest = this.absRemote(dest);
  let res = await this.conn
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
  this.logger({
    method: "stat",
    res: { dest, res: res.res },
    err: res.err,
  });
  return res;
}
async function list(destPath) {
  if (this.noConnection()) return this.noConnectionResponse;
  let absDest = this.absRemote(destPath);
  if ((await this.exists(destPath)).res != "d") {
    this.logger({
      method: "list",
      res: { destPath },
      err: `${absDest} is not a directory.`,
    });
    return { err: `${absDest} is not a directory.` };
  }
  let res = await this.conn
    .list(absDest)
    .then((r) => {
      r.forEach((v) => (v.rights = formatRights(v.rights)));
      return { err: null, res: r };
    })
    .catch((e) => {
      return { err: e.message };
    });
  this.logger({
    method: "list",
    res: { destPath, res: res.res },
    err: res.err,
  });
  return res;
}
async function mkDir(destPath) {
  if (this.noConnection()) return this.noConnectionResponse;
  let absDest = this.absRemote(destPath);
  if ((await this.exists(destPath)).res == "d") {
    this.logger({
      method: "mkDir",
      res: { destPath, res: `${destPath} already exists.` },
      err: null,
    });
    return { err: null };
  }
  let res = await this.conn
    .mkdir(absDest, true)
    .then((r) => {
      return { err: null };
    })
    .catch(async (e) => {
      let res = await this.exists(destPath);
      if (!res.err && res.res == "d") return { err: null };
      return { err: e.message };
    });
  this.logger({
    method: "mkDir",
    res: { destPath, res: res.res },
    err: res.err,
  });
  return res;
}
async function localListRecursive(
  localPath,
  _this,
  opts = { include: [], exclude: [] }
) {
  if (_this.noConnection()) return _this.noConnectionResponse;
  opts = _this.processOpts(opts);
  let res = [],
    absLocalPath = _this.absLocal(localPath);

  if (!fs.existsSync(absLocalPath))
    return { err: `No source directory ${absLocalPath} .` };

  if (!fs.lstatSync(absLocalPath).isDirectory())
    return { err: `${absLocalPath} is not a directory.` };

  let localFiles = fs.readdirSync(absLocalPath),
    dirChild = [];
  for (let i = 0; i < localFiles.length; i++) {
    let childLocal = path.join(localPath, localFiles[i]),
      childAbsLocal = _this.absLocal(childLocal),
      childStat = fs.lstatSync(childAbsLocal);
    if (childStat.isDirectory()) dirChild.push(childLocal);
    if (childStat.isFile()) {
      // console.warn("test ", childAbsLocal);
      if (opts[_this.testFnName](childAbsLocal))
        res.push({ type: "-", url: childAbsLocal });
    }
  }
  for (let i = 0; i < dirChild.length; i++) {
    let childDirRes = await localListRecursive(dirChild[i], _this, opts);
    if (!childDirRes.err && childDirRes.res.length) {
      res.push({
        type: "d",
        url: _this.absLocal(dirChild[i]),
        child: childDirRes.res,
      });
    }
  }
  return { err: null, res };
}
async function doPutDir(absSrcPath, absDestPath, files, _this) {
  let errs = [];
  let res = await _this.conn
    .mkdir(absDestPath, true)
    .then((r) => {
      return { err: null };
    })
    .catch(async (e) => {
      let r = await _this.conn
        .exists(absDestPath)
        .then((r) => {
          return { err: null, res: r };
        })
        .catch((e) => {
          return { err: e.message };
        });
      if (!r.err && r.res == "d") return { err: null };
      return { err: e.message };
    });
  if (res.err) return [res.err];
  for (let i = 0; i < files.length; i++) {
    if (files[i].type == "-") {
      let d = fs.createReadStream(files[i].url);
      let res = await _this.conn
        .put(d, files[i].url.replace(absSrcPath, absDestPath))
        .then((r) => {
          return { err: null };
        })
        .catch((e) => {
          return { err: e.message };
        });

      errs.push(res.err);
      _this.logger({
        method: "put",
        res: { src: absSrcPath, dest: absDestPath, res: res.res },
        err: res.err,
      });
    } else {
      errs = [
        ...errs,
        ...(await doPutDir(
          files[i].url,
          path.join(absDestPath, path.relative(absSrcPath, files[i].url)),
          files[i].child,
          _this
        )),
      ];
    }
  }
  return errs;
}
async function putDir(
  srcPath,
  destPath,
  _this,
  opts = { include: [], exclude: [] }
) {
  let absSrcPath = _this.absLocal(srcPath);
  let absDestPath = _this.absRemote(destPath);
  let destStat = await _this.exists(destPath);
  if (destStat.err) {
    _this.logger({
      method: "put",
      res: { src: srcPath, dest: destPath },
      err: destStat.err,
    });
    return destStat;
  }
  let stat = await localListRecursive(srcPath, _this, opts);
  if (stat.err) return stat;
  let err = (await doPutDir(absSrcPath, absDestPath, stat.res, _this))
    .filter((v) => v)
    .join("/n");
  if (err) return { err };
}
async function put(src, dest, opts = { include: [], exclude: [] }) {
  if (this.noConnection()) return this.noConnectionResponse;
  opts = this.processOpts(opts);
  let absSrc = this.absLocal(src);
  let absDest = this.absRemote(dest);
  if (!fs.existsSync(absSrc)) {
    this.logger({
      method: "put",
      res: { src, dest },
      err: `No source file or directory ${absSrc} .`,
    });
    return { err: `No source file or directory ${absSrc} .` };
  }
  if (fs.lstatSync(absSrc).isDirectory())
    return await putDir(src, dest, this, opts);
  if (!opts[testFnName](absSrc)) {
    this.logger({
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
    this.logger({
      method: "put",
      res: { src, dest },
      err: mkDirRes.err,
    });
    return mkDirRes;
  }
  let d = fs.createReadStream(absSrc);
  let res = await this.conn
    .put(d, absDest)
    .then((r) => {
      return { err: null };
    })
    .catch((e) => {
      return { err: e.message };
    });
  this.logger({
    method: "put",
    res: { src, dest, res: res.res },
    err: res.err,
  });
  return res;
}
module.exports = { hello, connect, quit, exists, stat, list, mkDir, put };
