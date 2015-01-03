/**
 * Ashe.js is a smart, fast, eval-less javascript templating library.
 */
define(function (require, exports, module) {
	
	"use strict";
	
	var uid, tokens,
			
	/**
	 * Recursive parsing method. Parse template string in context of provided object data.
	 * @param {String} str Template string.
	 * @param {Object} data Data for template.
	 */
	process = function(str, data) {
		return str.replace(/\{_(\d+?)\}/g, function(a, b) {
			var token = tokens[b], repl, i;
			if (!token.expr) {
				repl = evl(data, tokens[b].buffer);
				if (token.modif.length) {
					for (i in token.modif) {
						var modif = token.modif[i].trim(),
							params = [],
							check = token.modif[i].match(/(\w+)\(([\s\S]+)\)/);

						if (check) {
							modif  = check[1];
							params = explodeFilterArgs(data, check[2]);
						}
						params.unshift(repl);
						modif = Ashe.modifiers[modif] || window[modif];

						if (typeof modif != 'function') {
							throw new Error('Ashe: Unknown modifier "' + token.modif[i] + '".');
						}

						repl = modif.apply(this, params);
					}
				}
				return repl;
			}
			else {
				var block;
				switch (token.expr.type) {
					case 'if':
						var cond = evl(data, token.expr.cond);
						block = token.buffer.match(cond
							? /\{%\s*if\s+.+?\s*%\}([\s\S]*?)\{%/i
							: /\{%\s*else\s*%\}([\s\S]*?)\{%/i
						);
						return block ? process(block[1], data) : '';

					case 'for':
						var loopData = evl(data, token.expr.list);
						if (typeof loopData == 'undefined') {
							if (Ashe.debug) {
								throw new Error('Ashe: Undefined list "' + token.expr.list + '".');
							}
							return '';
						}

						if (hasElements(loopData)) {
							block = token.buffer.match(/\{%\s*for.*?\s*%\}([\s\S]*?)\{%/i);
							if (block) {
								var key, k,
									elem = token.expr.elem,
									split = elem.split(/\s*,\s*/),
									subStr = '';

								if (split.length == 2) {
									key = split[0];
									elem = split[1];
								}

								for (k in loopData) {
									if (loopData.hasOwnProperty(k)) {
										var tmpObj = {};
										for (var l in data) {
											tmpObj[l] = data[l];
										}
										if (key) tmpObj[key] = k;
										tmpObj[elem] = loopData[k];
										subStr += process(block[1], tmpObj);
									}
								}
								return subStr;
							}
							return '';
						}
						else {
							block = token.buffer.match(/\{%\s*else\s*%\}([\s\S]*?)\{%/i);
							return block ? process(block[1], loopData) : '';
						}
						break;

					case 'set':
						var t = token.expr,
							v = t.sval ? evl(data, t.sval) : process(token.buffer.replace(/\{%.*?%\}/g , ''), data);
						data[t.svar] = v;
						return '';
				}
			}
		});
	},

	/**
	 * Replace just markers between {{ and }}.
	 */
	proccessMarkers = function(str) {
		var i = 0;
		str = trim(str);

		while ((i = str.indexOf('{{', i)) != -1) {
			var id = uid++,
				end = str.indexOf('}}', i),
				buffer = trim(str.slice(i+2, end)).split('|'),
				repl = '{_' + id + '}';

			tokens[id] = {
				buffer: buffer.shift(),
				modif: buffer
			};

			str = replaceWith(str, repl, i, end+2);
			i = i + repl.length;
		}

		return str;
	},

	/**
	 * Replace control blocks, loops, conditions.
	 */
	proccessControls = function(str, i, lookingFor, exprDescr, inline) {
		var from = i;

		while ((i = str.indexOf('{%', i)) != -1) {
			var id = uid++,
				end = str.indexOf('%}', i),
				expr = str.slice(i+2, end),
				repl = '{_' + id + '}';

			if (inline || (lookingFor && expr.match(lookingFor))) {
				var start = from - 2;
				end = i + expr.length + 4;

				tokens[id] = {
					buffer: trim(str.slice(start, end)),
					expr: exprDescr
				};

				return replaceWith(str, repl, start, end);
			}
			else {
				var m;
				// For loop
				if (m = expr.match(/\s*for\s+((?:\w+\s*,)?\s*\w+)\s+in\s+(.+?)\s*$/i)) {
					str = proccessControls(str, i+2, /\s*endfor\s*/i, {
						type: 'for',
						elem: m[1],
						list: m[2]
					});
				}
				// If statement
				else if (m = expr.match(/\s*if\s+(.+)\s*/i)) {
					str = proccessControls(str, i+2, /\s*endif\s*/i, {
						type: 'if',
						cond: trim(m[1])
					});
				}
				// Set expression
				else if (m = expr.match(/\s*set\s+(\w+)(?:\s*=\s*(.*)?)?\s*/i)) {
					var dat = {
						type: 'set',
						svar: m[1],
						sval: m[2]
					};
					str = m[2]
						? proccessControls(str, i, null, dat, true)
						: proccessControls(str, i+2, /\s*endset\s*/i, dat);
				}
			}
			i = i + repl.length;
		}

		return str;
	},

	/**
	 * Need to flush closure vars before next parsing.
	 */
	reset = function() {
		uid = 1;
		tokens = {};
	},
			
	/**
	 * Resolve variables from the data scope.
	 */
	evl = function(data, buffer) {
		if ('\'"'.indexOf(buffer.substr(0, 1)) !== -1 &&
			buffer.substr(-1) === buffer.substr(0, 1)) {
			return buffer.substr(1, buffer.length - 2);
		}

		var parts = ~buffer.indexOf('.') ? buffer.split('.') : [buffer],
			i, l = parts.length,
			ret = data;
		
		for (i = 0; i < l; i++) {
			ret = ret[parts[i]];
			if (!ret) return '';
		}
		
		return typeof ret == 'function' ? ret.call(data) : ret;
	},

	/**
	 * Check if array or object is empty.
	 * @param {Array|Object}
	 */
	hasElements = function(obj) {
		if (obj.hasOwnProperty('length')) return !!obj.length;
		for (var k in obj) {
			if (obj.hasOwnProperty(k)) return true;
		}
		return false;
	},

	/**
	 * Trim whitespaces.
	 */
	trim = function(s) {
		return s.replace(/^\s*|\s*$/g, '');
	},

	/**
	 * Replace specified part of string.
	 */
	replaceWith = function(str, replace, start, end) {
		return str.substr(0, start) + replace + str.substr(end);
	},

	getFilterEndPos = function(str, start, chr) {
		var pos = str.substr(start).indexOf(chr);
		if (pos === -1) {
			console.error('A string is malformed');
			return -1;
		}

		if (str[start + pos - 1] === '\\') {
			return getFilterEndPos(str, start + pos, chr);
		}

		return start + pos;
	},

	explodeFilterArgs = function (data, str) {
		str = str.trim();

		if (str ===  '') {
			return [];
		}

		var delim = null;
		var arg = null;
		var end = 0;

		if ('\'"'.indexOf(str[0]) !== -1) {
			delim = str[0];
			end = getFilterEndPos(str, 1, delim);
			arg = str.substr(1, end - 1);
			end = str.indexOf(',');

			if (end === -1) {
				end = str.length + 1;
			}

		} else {
			end = str.indexOf(',');
			if (end === -1) {
				end = str.length + 1;
			}

			arg = str.substr(0, end - 1).trim();
			arg = evl(data, arg);
		}

		return [arg].concat(explodeFilterArgs(data, str.substr(end + 1)));
	},

	/**
	 * Turn on debug messages about undefined vars and problems of parsing.
	 */
	__debug = false,
			
	/**
	 * Modifiers object.
	 * @type {Object}
	 */
	__modifiers = {},
			
	/**
	 * Run analysing and parsing.
	 * @param {String} tplStr Template string.
	 * @param {Object} tplData Data passed to the template.
	 */
	__parse = function(tplStr, tplData) {
		return reset(), process(proccessControls(proccessMarkers(tplStr), 0), tplData || {});
	},
			
	/**
	 * Add new modifiers.
	 */
	__addModifiers = function(obj) {
		for (var i in obj) {
			if (obj.hasOwnProperty(i)) __modifiers[i] = obj[i];
		}
	};

	var Ashe = {
		debug: __debug,
		parse: __parse,
		modifiers: __modifiers,
		addModifiers: __addModifiers,
	};

	module.exports = Ashe;
});