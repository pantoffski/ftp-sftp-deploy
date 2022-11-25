"use strict";
const { timeStamp } = require("console");
let fs = require("fs");
let path = require("path");
const JSFtp = require("jsftp");
function hello() {
  console.log(`hello ${this.name}`);
}
async function connect(cfg) {
  if (typeof cfg.logger == "function") this.logger = cfg.logger;
  let res = await new Promise((resolve) => {
    let _ftp = new JSFtp({ host: cfg.host, port: cfg.port });
    _ftp.auth(cfg.username, cfg.password, (e) => {
      if (e) {
        _ftp.destroy();
        this.logger({
          method: "connect",
          res: `error connecting to ${cfg.host}`,
          err: e.message,
        });
        this.logger = () => {};
        resolve({ err: e.message });
      } else {
        this.localBasePath = cfg.localBasePath || "/";
        this.remoteBasePath = cfg.remoteBasePath || "/";

        this.logger({
          method: "connect",
          res: `connected to ${cfg.host}`,
          err: null,
        });
        resolve({ err: null, res: _ftp });
      }
    });
  });
  if (!res.err) {
    this.conn = res.res;
    return { err: null };
  }
  return res;
}
async function quit() {
  if (this.noConnection()) return this.noConnectionResponse;
  return await new Promise((resolve) => {
    this.conn.raw("quit", (e, data) => {
      if (e) {
        this.logger({
          method: "quit",
          res: `error ending connection`,
          err: e.message,
        });
        return resolve({ err: e.message });
      }
      conn = null;
      this.logger({
        method: "quit",
        res: `connection ended`,
        err: null,
      });
      this.logger = () => {};
      resolve({ err: null });
    });
  });
}
/**
 * @returns {boolean|string} false if not exists , 'd' -> directory , '-' -> file
 */
async function exists(dest) {
  if (this.noConnection()) return this.noConnectionResponse;
  let absDest = this.absRemote(dest);
  let res = await new Promise((resolve) => {
    conn.ls(absDest, (e, data) => {
      if (e) {
        if (e.message.indexOf("450 ") == 0)
          return resolve({ err: null, res: false });
        this.logger({
          method: "exists",
          res: `error calling 'exist' function for ${absDest}`,
          err: e.message,
        });
        return resolve({ err: e.message });
      }
      if (data.length == 1 && data[0].name == absDest)
        return resolve({ err: null, res: "-" });
      return resolve({ err: null, res: "d" });
    });
  });
  this.logger({
    method: "exists",
    res: `${absDest} exists`,
    err: res.err,
  });
  return res;
}
async function stat(dest) {
  if (this.noConnection()) return this.noConnectionResponse;
  let absDest = this.absRemote(dest);
  let res = await new Promise((resolve) => {
    this.conn.ls(absDest, async (e, data) => {
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
        upperDirList = await this.list(dest.split("/").slice(0, -1).join("/"));
      if (upperDirList.err) return upperDirList;

      let o = upperDirList.res.find((v) => v.name == dirName);
      if (o) return resolve({ err: null, res: o });

      return resolve({
        err: `Error retrive stat for ${dest}`,
      });
    });
  });
  this.logger({
    method: "stat",
    res: `Error retrive stat for ${dest}`,
    err: res.err,
  });
  return res;
}

async function list(destPath) {
  if (this.noConnection()) return this.noConnectionResponse;
  let absDest = this.absRemote(destPath);
  let res = await new Promise((resolve) => {
    this.conn.ls(absDest, (e, data) => {
      if (e) return resolve({ err: e.message });

      if (data.length == 1 && data[0].name == absDest)
        return resolve({
          err: `${absDest} is not a directory.`,
        });

      data = data.map((v) => formatStat(v));

      return resolve({ err: null, res: data });
    });
  });
  this.logger({
    method: "list",
    res: { destPath, res: res.res },
    err: res.err,
  });
  return res;
}

async function mkDirAbs(absDest, conn, remoteBasePath) {
  return await new Promise((resolve) => {
    conn.raw("cwd", absDest, async (e) => {
      if (e) {
        let paths = absDest.split("/"),
          idx = paths.length - 1,
          isOk = false;
        while (idx > 0 && !isOk) {
          let partPath = paths.slice(0, idx).join("/") || "/";

          let partExists = await retObj.exists(
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
            this.conn.raw("mkd", partPath, (e) => {
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
async function mkDir(destPath) {
  if (this.noConnection()) return this.noConnectionResponse;
  let absDest = this.absRemote(destPath);
  let res = await mkDirAbs(absDest, this.conn, this.remoteBasePath);
  this.logger({
    method: "mkDir",
    res: { destPath, res: res.res },
    err: res.err,
  });
  return res;
}
module.exports = { hello, connect, quit, exists, stat, list, mkDir };
