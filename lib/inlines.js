"use strict";

var Node = require('./node');
var common = require('./common');
var normalizeReference = require('./normalize-reference');

var normalizeURI = common.normalizeURI;
var unescapeString = common.unescapeString;
var fromCodePoint = require('./from-code-point.js');
var entityToChar = require('./html5-entities.js').entityToChar;

// Constants for character codes:

var C_NEWLINE = 10;
var C_ASTERISK = 42;
var C_UNDERSCORE = 95;
var C_BACKTICK = 96;
var C_OPEN_BRACKET = 91;
var C_CLOSE_BRACKET = 93;
var C_LESSTHAN = 60;
var C_BANG = 33;
var C_BACKSLASH = 92;
var C_AMPERSAND = 38;
var C_OPEN_PAREN = 40;
var C_CLOSE_PAREN = 41;
var C_COLON = 58;

// Some regexps used in inline parser:

var ESCAPABLE = '[!"#$%&\'()*+,./:;<=>?@[\\\\\\]^_`{|}~-]';
var ESCAPED_CHAR = '\\\\' + ESCAPABLE;
var REG_CHAR = '[^\\\\()\\x00-\\x20]';
var IN_PARENS_NOSP = '\\((' + REG_CHAR + '|' + ESCAPED_CHAR + ')*\\)';
var TAGNAME = '[A-Za-z][A-Za-z0-9]*';
var ATTRIBUTENAME = '[a-zA-Z_:][a-zA-Z0-9:._-]*';
var UNQUOTEDVALUE = "[^\"'=<>`\\x00-\\x20]+";
var SINGLEQUOTEDVALUE = "'[^']*'";
var DOUBLEQUOTEDVALUE = '"[^"]*"';
var ATTRIBUTEVALUE = "(?:" + UNQUOTEDVALUE + "|" + SINGLEQUOTEDVALUE + "|" + DOUBLEQUOTEDVALUE + ")";
var ATTRIBUTEVALUESPEC = "(?:" + "\\s*=" + "\\s*" + ATTRIBUTEVALUE + ")";
var ATTRIBUTE = "(?:" + "\\s+" + ATTRIBUTENAME + ATTRIBUTEVALUESPEC + "?)";
var OPENTAG = "<" + TAGNAME + ATTRIBUTE + "*" + "\\s*/?>";
var CLOSETAG = "</" + TAGNAME + "\\s*[>]";
var HTMLCOMMENT = "<!---->|<!--(?:-?[^>-])(?:-?[^-])*-->";
var PROCESSINGINSTRUCTION = "[<][?].*?[?][>]";
var DECLARATION = "<![A-Z]+" + "\\s+[^>]*>";
var CDATA = "<!\\[CDATA\\[[\\s\\S]*?\\]\\]>";
var HTMLTAG = "(?:" + OPENTAG + "|" + CLOSETAG + "|" + HTMLCOMMENT + "|" +
        PROCESSINGINSTRUCTION + "|" + DECLARATION + "|" + CDATA + ")";
var ENTITY = "&(?:#x[a-f0-9]{1,8}|#[0-9]{1,8}|[a-z][a-z0-9]{1,31});";

var rePunctuation = new RegExp(/^[\u2000-\u206F\u2E00-\u2E7F\\'!"#\$%&\(\)\*\+,\-\.\/:;<=>\?@\[\]\^_`\{\|\}~]/);

var reHtmlTag = new RegExp('^' + HTMLTAG, 'i');

var reLinkTitle = new RegExp(
    '^(?:"(' + ESCAPED_CHAR + '|[^"\\x00])*"' +
        '|' +
        '\'(' + ESCAPED_CHAR + '|[^\'\\x00])*\'' +
        '|' +
        '\\((' + ESCAPED_CHAR + '|[^)\\x00])*\\))');

var reLinkDestinationBraces = new RegExp(
    '^(?:[<](?:[^<>\\n\\\\\\x00]' + '|' + ESCAPED_CHAR + '|' + '\\\\)*[>])');

var reLinkDestination = new RegExp(
    '^(?:' + REG_CHAR + '+|' + ESCAPED_CHAR + '|' + IN_PARENS_NOSP + ')*');

var reEscapable = new RegExp('^' + ESCAPABLE);

var reEntityHere = new RegExp('^' + ENTITY, 'i');

var reTicks = /`+/;

var reTicksHere = /^`+/;

var reEmailAutolink = /^<([a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)>/;

var reAutolink = /^<(?:coap|doi|javascript|aaa|aaas|about|acap|cap|cid|crid|data|dav|dict|dns|file|ftp|geo|go|gopher|h323|http|https|iax|icap|im|imap|info|ipp|iris|iris.beep|iris.xpc|iris.xpcs|iris.lwz|ldap|mailto|mid|msrp|msrps|mtqp|mupdate|news|nfs|ni|nih|nntp|opaquelocktoken|pop|pres|rtsp|service|session|shttp|sieve|sip|sips|sms|snmp|soap.beep|soap.beeps|tag|tel|telnet|tftp|thismessage|tn3270|tip|tv|urn|vemmi|ws|wss|xcon|xcon-userid|xmlrpc.beep|xmlrpc.beeps|xmpp|z39.50r|z39.50s|adiumxtra|afp|afs|aim|apt|attachment|aw|beshare|bitcoin|bolo|callto|chrome|chrome-extension|com-eventbrite-attendee|content|cvs|dlna-playsingle|dlna-playcontainer|dtn|dvb|ed2k|facetime|feed|finger|fish|gg|git|gizmoproject|gtalk|hcp|icon|ipn|irc|irc6|ircs|itms|jar|jms|keyparc|lastfm|ldaps|magnet|maps|market|message|mms|ms-help|msnim|mumble|mvn|notes|oid|palm|paparazzi|platform|proxy|psyc|query|res|resource|rmi|rsync|rtmp|secondlife|sftp|sgn|skype|smb|soldat|spotify|ssh|steam|svn|teamspeak|things|udp|unreal|ut2004|ventrilo|view-source|webcal|wtai|wyciwyg|xfire|xri|ymsgr):[^<>\x00-\x20]*>/i;

var reSpnl = /^ *(?:\n *)?/;

var reWhitespaceChar = /^\s/;

var reWhitespace = /\s+/g;

var reFinalSpace = / *$/;

var reInitialSpace = /^ */;

var reLinkLabel = /^\[(?:[^\\\[\]]|\\[\[\]]){0,1000}\]/;

// Matches a string of non-special characters.
var reMain = /^[^\n`\[\]\\!<&*_]+/m;

var text = function(s) {
    var node = new Node('Text');
    node._literal = s;
    return node;
};

// INLINE PARSER

// These are methods of an InlineParser object, defined below.
// An InlineParser keeps track of a subject (a string to be
// parsed) and a position in that subject.

// If re matches at current position in the subject, advance
// position in subject and return the match; otherwise return null.
var match = function(re) {
    var m = re.exec(this.subject.slice(this.pos));
    if (m === null) {
        return null;
    } else {
        this.pos += m.index + m[0].length;
        return m[0];
    }
};

// Returns the code for the character at the current subject position, or -1
// there are no more characters.
var peek = function() {
    if (this.pos < this.subject.length) {
        return this.subject.charCodeAt(this.pos);
    } else {
        return -1;
    }
};

// Parse zero or more space characters, including at most one newline
var spnl = function() {
    this.match(reSpnl);
    return 1;
};

// All of the parsers below try to match something at the current position
// in the subject.  If they succeed in matching anything, they
// return the inline matched, advancing the subject.

// Attempt to parse backticks, adding either a backtick code span or a
// literal sequence of backticks.
var parseBackticks = function(block) {
    var ticks = this.match(reTicksHere);
    if (ticks === null) {
        return 0;
    }
    var afterOpenTicks = this.pos;
    var matched;
    var node;
    while ((matched = this.match(reTicks)) !== null) {
        if (matched === ticks) {
            node = new Node('Code');
            node._literal = this.subject.slice(afterOpenTicks,
                                        this.pos - ticks.length)
                          .trim().replace(reWhitespace, ' ');
            block.appendChild(node);
            return true;
        }
    }
    // If we got here, we didn't match a closing backtick sequence.
    this.pos = afterOpenTicks;
    block.appendChild(text(ticks));
    return true;
};

// Parse a backslash-escaped special character, adding either the escaped
// character, a hard line break (if the backslash is followed by a newline),
// or a literal backslash to the block's children.  Assumes current character
// is a backslash.
var parseBackslash = function(block) {
    var subj = this.subject,
        pos = this.pos;
    var node;
    if (subj.charCodeAt(pos + 1) === C_NEWLINE) {
        this.pos = this.pos + 2;
        node = new Node('Hardbreak');
        block.appendChild(node);
    } else if (reEscapable.test(subj.charAt(pos + 1))) {
        this.pos = this.pos + 2;
        block.appendChild(text(subj.charAt(pos + 1)));
    } else {
        this.pos++;
        block.appendChild(text('\\'));
    }
    return true;
};

// Attempt to parse an autolink (URL or email in pointy brackets).
var parseAutolink = function(block) {
    var m;
    var dest;
    var node;
    if ((m = this.match(reEmailAutolink))) {
        dest = m.slice(1, m.length - 1);
        node = new Node('Link');
        node._destination = normalizeURI('mailto:' + dest);
        node._title = '';
        node.appendChild(text(dest));
        block.appendChild(node);
        return true;
    } else if ((m = this.match(reAutolink))) {
        dest = m.slice(1, m.length - 1);
        node = new Node('Link');
        node._destination = normalizeURI(dest);
        node._title = '';
        node.appendChild(text(dest));
        block.appendChild(node);
        return true;
    } else {
        return false;
    }
};

// Attempt to parse a raw HTML tag.
var parseHtmlTag = function(block) {
    var m = this.match(reHtmlTag);
    if (m === null) {
        return false;
    } else {
        var node = new Node('Html');
        node._literal = m;
        block.appendChild(node);
        return true;
    }
};

// Scan a sequence of characters with code cc, and return information about
// the number of delimiters and whether they are positioned such that
// they can open and/or close emphasis or strong emphasis.  A utility
// function for strong/emph parsing.
var scanDelims = function(cc) {
    var numdelims = 0;
    var char_before, char_after, cc_after;
    var startpos = this.pos;
    var left_flanking, right_flanking, can_open, can_close;

    char_before = this.pos === 0 ? '\n' :
        this.subject.charAt(this.pos - 1);

    while (this.peek() === cc) {
        numdelims++;
        this.pos++;
    }

    cc_after = this.peek();
    if (cc_after === -1) {
        char_after = '\n';
    } else {
        char_after = fromCodePoint(cc_after);
    }

    left_flanking = numdelims > 0 &&
            !(reWhitespaceChar.test(char_after)) &&
            !(rePunctuation.test(char_after) &&
             !(reWhitespaceChar.test(char_before)) &&
             !(rePunctuation.test(char_before)));
    right_flanking = numdelims > 0 &&
            !(reWhitespaceChar.test(char_before)) &&
            !(rePunctuation.test(char_before) &&
              !(reWhitespaceChar.test(char_after)) &&
              !(rePunctuation.test(char_after)));
    if (cc === C_UNDERSCORE) {
        can_open = left_flanking && !right_flanking;
        can_close = right_flanking && !left_flanking;
    } else {
        can_open = left_flanking;
        can_close = right_flanking;
    }
    this.pos = startpos;
    return { numdelims: numdelims,
             can_open: can_open,
             can_close: can_close };
};

// Attempt to parse emphasis or strong emphasis.
var parseEmphasis = function(cc, block) {
    var res = this.scanDelims(cc);
    var numdelims = res.numdelims;
    var startpos = this.pos;

    if (numdelims === 0) {
        return false;
    }

    this.pos += numdelims;
    var node = text(this.subject.slice(startpos, this.pos));
    block.appendChild(node);

    // Add entry to stack for this opener
    this.delimiters = { cc: cc,
                        numdelims: numdelims,
                        node: node,
                        previous: this.delimiters,
                        next: null,
                        can_open: res.can_open,
                        can_close: res.can_close,
                        active: true };
    if (this.delimiters.previous !== null) {
        this.delimiters.previous.next = this.delimiters;
    }

    return true;

};

var removeDelimiter = function(delim) {
    if (delim.previous !== null) {
        delim.previous.next = delim.next;
    }
    if (delim.next === null) {
        // top of stack
        this.delimiters = delim.previous;
    } else {
        delim.next.previous = delim.previous;
    }
};

var processEmphasis = function(block, stack_bottom) {
    var opener, closer;
    var opener_inl, closer_inl;
    var nextstack, tempstack;
    var use_delims;
    var tmp, next;

    // find first closer above stack_bottom:
    closer = this.delimiters;
    while (closer !== null && closer.previous !== stack_bottom) {
        closer = closer.previous;
    }
    // move forward, looking for closers, and handling each
    while (closer !== null) {
        if (closer.can_close && (closer.cc === C_UNDERSCORE || closer.cc === C_ASTERISK)) {
            // found emphasis closer. now look back for first matching opener:
            opener = closer.previous;
            while (opener !== null && opener !== stack_bottom) {
                if (opener.cc === closer.cc && opener.can_open) {
                    break;
                }
                opener = opener.previous;
            }
            if (opener !== null && opener !== stack_bottom) {
                // calculate actual number of delimiters used from this closer
                if (closer.numdelims < 3 || opener.numdelims < 3) {
                    use_delims = closer.numdelims <= opener.numdelims ?
                        closer.numdelims : opener.numdelims;
                } else {
                    use_delims = closer.numdelims % 2 === 0 ? 2 : 1;
                }

                opener_inl = opener.node;
                closer_inl = closer.node;

                // remove used delimiters from stack elts and inlines
                opener.numdelims -= use_delims;
                closer.numdelims -= use_delims;
                opener_inl._literal =
                    opener_inl._literal.slice(0,
                                     opener_inl._literal.length - use_delims);
                closer_inl._literal =
                    closer_inl._literal.slice(0,
                                     closer_inl._literal.length - use_delims);

                // build contents for new emph element
                var emph = new Node(use_delims === 1 ? 'Emph' : 'Strong');

                tmp = opener_inl._next;
                while (tmp && tmp !== closer_inl) {
                    next = tmp._next;
                    tmp.unlink();
                    emph.appendChild(tmp);
                    tmp = next;
                }

                opener_inl.insertAfter(emph);

                // remove elts btw opener and closer in delimiters stack
                tempstack = closer.previous;
                while (tempstack !== null && tempstack !== opener) {
                    nextstack = tempstack.previous;
                    this.removeDelimiter(tempstack);
                    tempstack = nextstack;
                }

                // if opener has 0 delims, remove it and the inline
                if (opener.numdelims === 0) {
                    opener_inl.unlink();
                    this.removeDelimiter(opener);
                }

                if (closer.numdelims === 0) {
                    closer_inl.unlink();
                    tempstack = closer.next;
                    this.removeDelimiter(closer);
                    closer = tempstack;
                }

            } else {
                closer = closer.next;
            }

        } else {
            closer = closer.next;
        }

    }

    // remove all delimiters
    while (this.delimiters !== stack_bottom) {
        this.removeDelimiter(this.delimiters);
    }
};

// Attempt to parse link title (sans quotes), returning the string
// or null if no match.
var parseLinkTitle = function() {
    var title = this.match(reLinkTitle);
    if (title === null) {
        return null;
    } else {
        // chop off quotes from title and unescape:
        return unescapeString(title.substr(1, title.length - 2));
    }
};

// Attempt to parse link destination, returning the string or
// null if no match.
var parseLinkDestination = function() {
    var res = this.match(reLinkDestinationBraces);
    if (res === null) {
        res = this.match(reLinkDestination);
        if (res === null) {
            return null;
        } else {
            return normalizeURI(unescapeString(res));
        }
    } else {  // chop off surrounding <..>:
        return normalizeURI(unescapeString(res.substr(1, res.length - 2)));
    }
};

// Attempt to parse a link label, returning number of characters parsed.
var parseLinkLabel = function() {
    var m = this.match(reLinkLabel);
    return m === null ? 0 : m.length;
};

// Add open bracket to delimiter stack and add a text node to block's children.
var parseOpenBracket = function(block) {
    var startpos = this.pos;
    this.pos += 1;

    var node = text('[');
    block.appendChild(node);

    // Add entry to stack for this opener
    this.delimiters = { cc: C_OPEN_BRACKET,
                        numdelims: 1,
                        node: node,
                        previous: this.delimiters,
                        next: null,
                        can_open: true,
                        can_close: false,
                        index: startpos,
                        active: true };
    if (this.delimiters.previous !== null) {
        this.delimiters.previous.next = this.delimiters;
    }

    return true;

};

// IF next character is [, and ! delimiter to delimiter stack and
// add a text node to block's children.  Otherwise just add a text node.
var parseBang = function(block) {
    var startpos = this.pos;
    this.pos += 1;
    if (this.peek() === C_OPEN_BRACKET) {
        this.pos += 1;

        var node = text('![');
        block.appendChild(node);

        // Add entry to stack for this opener
        this.delimiters = { cc: C_BANG,
                            numdelims: 1,
                            node: node,
                            previous: this.delimiters,
                            next: null,
                            can_open: true,
                            can_close: false,
                            index: startpos + 1,
                            active: true };
        if (this.delimiters.previous !== null) {
            this.delimiters.previous.next = this.delimiters;
        }
    } else {
        block.appendChild(text('!'));
    }
    return true;
};

// Try to match close bracket against an opening in the delimiter
// stack.  Add either a link or image, or a plain [ character,
// to block's children.  If there is a matching delimiter,
// remove it from the delimiter stack.
var parseCloseBracket = function(block) {
    var startpos;
    var is_image;
    var dest;
    var title;
    var matched = false;
    var reflabel;
    var opener;

    this.pos += 1;
    startpos = this.pos;

    // look through stack of delimiters for a [ or ![
    opener = this.delimiters;

    while (opener !== null) {
        if (opener.cc === C_OPEN_BRACKET || opener.cc === C_BANG) {
            break;
        }
        opener = opener.previous;
    }

    if (opener === null) {
        // no matched opener, just return a literal
        block.appendChild(text(']'));
        return true;
    }

    if (!opener.active) {
        // no matched opener, just return a literal
        block.appendChild(text(']'));
        // take opener off emphasis stack
        this.removeDelimiter(opener);
        return true;
    }

    // If we got here, open is a potential opener
    is_image = opener.cc === C_BANG;

    // Check to see if we have a link/image

    // Inline link?
    if (this.peek() === C_OPEN_PAREN) {
        this.pos++;
        if (this.spnl() &&
            ((dest = this.parseLinkDestination()) !== null) &&
            this.spnl() &&
            // make sure there's a space before the title:
            (reWhitespaceChar.test(this.subject.charAt(this.pos - 1)) &&
             (title = this.parseLinkTitle()) || true) &&
            this.spnl() &&
            this.subject.charCodeAt(this.pos) === C_CLOSE_PAREN) {
            this.pos += 1;
            matched = true;
        }
    } else {

        // Next, see if there's a link label
        var savepos = this.pos;
        this.spnl();
        var beforelabel = this.pos;
        var n = this.parseLinkLabel();
        if (n === 0 || n === 2) {
            // empty or missing second label
            reflabel = this.subject.slice(opener.index, startpos);
        } else {
            reflabel = this.subject.slice(beforelabel, beforelabel + n);
        }
        if (n === 0) {
            // If shortcut reference link, rewind before spaces we skipped.
            this.pos = savepos;
        }

        // lookup rawlabel in refmap
        var link = this.refmap[normalizeReference(reflabel)];
        if (link) {
            dest = link.destination;
            title = link.title;
            matched = true;
        }
    }

    if (matched) {
        var node = new Node(is_image ? 'Image' : 'Link');
        node._destination = dest;
        node._title = title || '';

        var tmp, next;
        tmp = opener.node._next;
        while (tmp) {
            next = tmp._next;
            tmp.unlink();
            node.appendChild(tmp);
            tmp = next;
        }
        block.appendChild(node);
        this.processEmphasis(node, opener.previous);

        opener.node.unlink();

        // processEmphasis will remove this and later delimiters.
        // Now, for a link, we also deactivate earlier link openers.
        // (no links in links)
        if (!is_image) {
          opener = this.delimiters;
          while (opener !== null) {
            if (opener.cc === C_OPEN_BRACKET) {
                opener.active = false; // deactivate this opener
            }
            opener = opener.previous;
          }
        }

        return true;

    } else { // no match

        this.removeDelimiter(opener);  // remove this opener from stack
        this.pos = startpos;
        block.appendChild(text(']'));
        return true;
    }

};

// Attempt to parse an entity, return Entity object if successful.
var parseEntity = function(block) {
    var m;
    if ((m = this.match(reEntityHere))) {
        block.appendChild(text(entityToChar(m)));
        return true;
    } else {
        return false;
    }
};

// Parse a run of ordinary characters, or a single character with
// a special meaning in markdown, as a plain string.
var parseString = function(block) {
    var m;
    if ((m = this.match(reMain))) {
        block.appendChild(text(m));
        return true;
    } else {
        return false;
    }
};

// Parse a newline.  If it was preceded by two spaces, return a hard
// line break; otherwise a soft line break.
var parseNewline = function(block) {
    this.pos += 1; // assume we're at a \n
    // check previous node for trailing spaces
    var lastc = block._lastChild;
    if (lastc && lastc.type === 'Text') {
        var sps = reFinalSpace.exec(lastc._literal)[0].length;
        if (sps > 0) {
            lastc._literal = lastc._literal.replace(reFinalSpace, '');
        }
        block.appendChild(new Node(sps >= 2 ? 'Hardbreak' : 'Softbreak'));
    } else {
        block.appendChild(new Node('Softbreak'));
    }
    this.match(reInitialSpace); // gobble leading spaces in next line
    return true;
};

// Attempt to parse a link reference, modifying refmap.
var parseReference = function(s, refmap) {
    this.subject = s;
    this.pos = 0;
    var rawlabel;
    var dest;
    var title;
    var matchChars;
    var startpos = this.pos;

    // label:
    matchChars = this.parseLinkLabel();
    if (matchChars === 0) {
        return 0;
    } else {
        rawlabel = this.subject.substr(0, matchChars);
    }

    // colon:
    if (this.peek() === C_COLON) {
        this.pos++;
    } else {
        this.pos = startpos;
        return 0;
    }

    //  link url
    this.spnl();

    dest = this.parseLinkDestination();
    if (dest === null || dest.length === 0) {
        this.pos = startpos;
        return 0;
    }

    var beforetitle = this.pos;
    this.spnl();
    title = this.parseLinkTitle();
    if (title === null) {
        title = '';
        // rewind before spaces
        this.pos = beforetitle;
    }

    // make sure we're at line end:
    if (this.match(/^ *(?:\n|$)/) === null) {
        this.pos = startpos;
        return 0;
    }

    var normlabel = normalizeReference(rawlabel);

    if (!refmap[normlabel]) {
        refmap[normlabel] = { destination: dest, title: title };
    }
    return this.pos - startpos;
};

// Parse the next inline element in subject, advancing subject position.
// On success, add the result to block's children and return true.
// On failure, return false.
var parseInline = function(block) {
    var res = false;
    var c = this.peek();
    if (c === -1) {
        return false;
    }
    switch(c) {
    case C_NEWLINE:
        res = this.parseNewline(block);
        break;
    case C_BACKSLASH:
        res = this.parseBackslash(block);
        break;
    case C_BACKTICK:
        res = this.parseBackticks(block);
        break;
    case C_ASTERISK:
    case C_UNDERSCORE:
        res = this.parseEmphasis(c, block);
        break;
    case C_OPEN_BRACKET:
        res = this.parseOpenBracket(block);
        break;
    case C_BANG:
        res = this.parseBang(block);
        break;
    case C_CLOSE_BRACKET:
        res = this.parseCloseBracket(block);
        break;
    case C_LESSTHAN:
        res = this.parseAutolink(block) || this.parseHtmlTag(block);
        break;
    case C_AMPERSAND:
        res = this.parseEntity(block);
        break;
    default:
        res = this.parseString(block);
        break;
    }
    if (!res) {
        this.pos += 1;
        block.appendChild(text(fromCodePoint(c)));
    }

    return true;
};

// Parse string content in block into inline children,
// using refmap to resolve references.
var parseInlines = function(block) {
    this.subject = block._string_content.trim();
    this.pos = 0;
    this.delimiters = null;
    while (this.parseInline(block)) {
    }
    block._string_content = null; // allow raw string to be garbage collected
    this.processEmphasis(block, null);
};

// The InlineParser object.
function InlineParser(){
    return {
        subject: '',
        delimiters: null,  // used by parseEmphasis method
        pos: 0,
        refmap: {},
        match: match,
        peek: peek,
        spnl: spnl,
        parseBackticks: parseBackticks,
        parseBackslash: parseBackslash,
        parseAutolink: parseAutolink,
        parseHtmlTag: parseHtmlTag,
        scanDelims: scanDelims,
        parseEmphasis: parseEmphasis,
        parseLinkTitle: parseLinkTitle,
        parseLinkDestination: parseLinkDestination,
        parseLinkLabel: parseLinkLabel,
        parseOpenBracket: parseOpenBracket,
        parseCloseBracket: parseCloseBracket,
        parseBang: parseBang,
        parseEntity: parseEntity,
        parseString: parseString,
        parseNewline: parseNewline,
        parseReference: parseReference,
        parseInline: parseInline,
        processEmphasis: processEmphasis,
        removeDelimiter: removeDelimiter,
        parse: parseInlines
    };
}

module.exports = InlineParser;
