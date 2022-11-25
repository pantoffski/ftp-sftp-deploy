function factory(what = "ftp") {
  const { processOpts, absLocal, absRemote } = require("./common");
  const retObj = {
    isFtp: what.trim().toLowerCase() == "ftp",
    noConnectionResponse: {
      err: `No ${this.isFtp ? "" : "S"}FTP connection available`,
    },
    noConnection() {
      if (!this.conn) return true;
      if (!this.isFtp && !this.conn.sftp) return true;
      return false;
    },
    testFnName: Math.random().toString(36).replace("0.", "_"),
    processOpts,
    absLocal,
    absRemote,
    logger: () => {},
    conn: null,
    localBasePath: "/",
    remoteBasePath: "/",
    name: "mai",
  };
  const fns = [
    "hello",
    "connect",
    "quit",
    "exists",
    "stat",
    "list",
    "mkDir",
    "put",
  ];
  if (what == "sftp") {
    fns.map((k) => (retObj[k] = require("./sftp")[k]));
  } else {
    fns.map((k) => (retObj[k] = require("./ftp")[k]));
  }
  return retObj;
}
module.exports = { FTP: () => factory("ftp"), SFTP: () => factory("sftp") };
