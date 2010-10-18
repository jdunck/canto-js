/*
 * Copyright 2010 David Flanagan
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

/**
 * canto.js: an improved API for drawing in canvases.  Version 0.15
 * 
 * Invoke the canto() factory function with an <canvas> element or the id
 * of a canvas element.  It returns an object that implements the 2D canvas
 * API, but adds new methods and improves on existing methods to make it
 * easier to draw.  Highlights of the improved API include:
 * 
 * - All methods with no other return value return the canto so they can 
 *   be chained: canto("mycanvas").moveTo(0,0).lineTo(50,50).stroke();
 *
 * - Most path methods accept multiple sets of coordinates, so if you pass
 *   6 arguments to lineTo() you get three connected line segments
 * 
 * - Relative coordinate versions of the path building methods such as
 *   rlineTo, rmoveTo, etc.
 *
 * - Turtle-graphics methods such as penDown(), forward(), right(), etc.
 * 
 * - A polygon method for connecting a list of coordinates, with optional
 *   rounded corners.
 *
 * - Short aliases for path generation methods, using the SVG path command
 *   letters.  m is relative moveto, L is absolute lineto, z is closePath, etc.
 * 
 * - A new svgpath() method that draws an path using the syntax of the
 *   d attribute of the SVG <path> element. This is a very compact way
 *   to describe paths.
 * 
 * - An angleUnit attribute that you can set to "degrees" instead of
 *   the default "radians"
 * 
 * - A new method set() allows bulk setting of graphics attributes.
 *   and allows an object to represent a set of attributes.
 * 
 * - Methods like stroke(), fill() and drawText() that perform drawing
 *   can be passed a set of attributes that will be used for that one operation
 *   but which will not affect current state.
 *
 * - A new method revert() reverts the graphics state back to the last save()
 *   without popping the state. Shorthand for restore();save();
 * 
 * - A new method paint() that fills and then strokes the current path.
 * 
 * - The rect() method is extended to take optional corner radius and
 *   rotation arguments
 * 
 * - A new ellipse() method is like arc() but supports elliptical arcs
 *   and rotation in addition to circular arcs.
 * 
 * - drawImage() and createPattern() accept a string as the image argument
 *   If it begins with # it is taken as an element id. Otherwise it is taken
 *   as an image URL.
 *     XXX: WARNING: drawImage() will ignore images that are not fully loaded
 *      yet, so specifying an image as a URL will probably not work unless
 *      the image is already in the browser cache.  So maybe I'll just say
 *      that any string is an element id and remove the URL capability 
 *      completely.  Alternatively, would some kind of async drawImage() work?
 *    
 * - the create*Gradient() methods accept a list of color stops so you can
 *   create gradients in a single step
 * 
 * - A new method textWidth(txt) that returns measureText(txt).width
 *
 * - A canto() object implements the Canvas2DContext API, but also implements
 *   the properies and methods of the Canvas itself: width, height, and
 *   toDataURL()
 *
 * - a reset() method that clears and resets the state of the canvas
 *
 * Current limitations:
 * 
 * - Canto uses getters and setters; therefore, it does not work in IE.
 * 
 * - Canto does not keep track of the current point or the start of
 *   the current subpath across transformations.  This means that if
 *   you do a transform (translate, scale, rotate, transform, setTransform)
 *   you cannot use relative motion commands until you have established
 *   a new current point (with moveTo() or lineTo(), for example).  Also,
 *   you cannot use a relative motion command after closePath() if you
 *   performed a transformation after establishing the initial point of
 *   that subpath. This also applies to the non-relative path commands 
 *   H(), V(), S(), T(), A(), and arcTo(). This restriction won't effect you
 *   if you set up your coordinate transformations before defining your
 *   paths.  The fix to this limitation involves tracking the current 
 *   transformation matrix across save/restore boundaries.
 */



/**
 * The canto() factory function is the main entry point for using canto.
 * Pass it an HTMLCanvasElement, or the id of a canvas element, and it
 * returns the canto object (the enhanced 2D drawing context) for that
 * canvas.  Calling this function is like calling canvas.getContext('2d')
 * but the return value is more useful.  As with the 2D drawing context
 * there is only one canto object per canvas, so multiple calls for
 * the same canvas element return the same object.
 */
var canto = (function() {  // This function returns the canto() function
    // For more compact mathematical expressions
    var sin = Math.sin, cos = Math.cos, tan = Math.tan;
    var acos = Math.acos, sqrt = Math.sqrt, abs = Math.abs;
    var pi = Math.PI, twopi = 2*Math.PI;

    /*
     * Non-exported utility Functions.
     * Defined here to make jslint happy.
     */

    // Return a function that just delegates to the named method of this._
    function wrap(methodname) {
        return function() {
            return this._[methodname].apply(this._, arguments);
        };
    }

    // Return a function that just delegates to the named method of this._
    // and then returns this.
    function wrapAndReturn(methodname) {
        return function() {
            this._[methodname].apply(this._, arguments);
            return this;
        };
    }

    // If there is no current supath, then start one at this point.
    // This is from the spec.
    function ensure(c,x,y) {
        if (c._pathIsEmpty) c.moveTo(x,y);
    }
    
    function setcurrent(c,x,y) {
        c.currentX = x;
        c.currentY = y;
        c._lastCCP = null;  // Reset control point status
        c._lastQCP = null;
        c._pathIsEmpty = false;
    }

    // Check that the current point is defined and throw an exception if
    // it is not defined.  This is used by relative motion commands.
    function checkcurrent(c) {
        if (c.currentX === undefined) 
            throw new Error("No current point; can't use relative coordinates");
    }

    // Utility function to convert a string to an Image object
    // XXX: Specifying a URL probably won't work unless that URL
    //  is already loaded in the browser cache.  The canvas can ignore
    //  drawImage requests if the image object has not yet finished 
    //  loading.  I may need to remove that bit of the API.
    function getImage(img) {
        if (typeof img !== "string") return img;
        var image = null;
        if (img.charAt(0) === '#') // image is probably an element id
            image = document.getElementById(img.substring(1));
        if (!image) {        // Otherwise, assume img is a URL
            image = new Image();
            image.src = img;
        }

        return image;
    }

    function slice(arraylike, from, to) {
        if (to === undefined) to = arraylike.length;
        return Array.prototype.slice.call(arraylike, from, to);
    }
    
    function addColorStops(gradient, args) {
        if (args.length % 2 !== 0) 
            throw new Error("wrong number of arguments");
        for(var i = 0; i < args.length; i+=2) 
            gradient.addColorStop(args[i], args[i+1]);
    }

    // Utility to check that args.length === n or (args.length % m) === n
    // and that args.length < min. Throws an error otherwise.
    // Only the first two arguments are required
    function check(args, n, m, min) {
        if (n !== (m ? args.length % m : args.length) || args.length < min)
            throw new Error("wrong number of arguments");
    }

    // convert an degrees to radians if _useDegrees is set,
    // otherwise assume angle is already in radians and return unchanged
    function convertAngle(c,x) { return c._useDegrees ? (x*pi/180) : x; }


    // Return the angle between vectors (x1,y1) and (x2,y2)
    // This is from Wikipedia and SVG F.6 implementation notes.
    // Returns a value between -pi and +pi
    function angleBetweenVectors(x1,y1,x2,y2) {
        var dotproduct = x1*x2 + y1*y2;
        var d1 = sqrt(x1*x1 + y1*y1);
        var d2 = sqrt(x2*x2 + y2*y2);
        var x = dotproduct/(d1*d2);
        // Rounding errors can cause x to be slightly greater than 1
        if (x > 1) x = 1;
        if (x < -1) x = -1;
        var angle = abs(acos(x));
        var sign = x1*y2 - y1*x2;
        if (sign === abs(sign)) return angle;
        else return -angle;
    }

    function rotatePoint(x,y,angle) {
        return [ x*cos(angle) - y*sin(angle),
                 y*cos(angle) + x*sin(angle)];
    }

    // Use by the Canto() constructor and the reset() method
    function resetCantoState(c) {
        // Properties to hold the current point
        c.currentX = c.currentY = undefined;

        // Properties to hold the start point of the current subpath
        c.startSubpathX = c.startSubpathY = undefined;

        // Whether angles are measured in degrees (true) or radians (false)
        c._useDegrees = false;
        c._angleUnitStack = [];
        
        // Properties for turtle graphics commands only
        c._penup = true;
        c._orientation = -pi/2;  // Straight up

        // These properties are needed by the SVG S, s, T, and t commands
        c._lastCCP = undefined; // last cubic control point
        c._lastQCP = undefined; // last quadratic control point
    }


    /*
     * Canto Methods
     * The functions below here will be stored in the Canto.prototype
     * object and become Canto methods.
     */

    // These two regular expressions are used in the svgpath() function
    var svgnumber = /[+\-]?(\.\d+|\d+\.\d*|\d+)([Ee][+\-]?\d+)?/g;
    var svgpathelt = /[MmLlZzHhVvCcQqSsTtAa]\s*(([+\-]?(\d+|\d+\.\d*|\.\d+)([Ee][+\-]?\d+)?)(,\s*|\s+,?\s*)?)*/g;

    // Parse an SVG path string and invoke the various SVG commands
    // Note that this does not call beginPath()
    function svgpath(text) {
        var elements = text.match(svgpathelt);
        if (!elements) throw new Error("Bad path: " + text);

        // Each element should begin with a SVG path letter and be followed
        // by a string of numbers separated by spaces and/or commas
        for(var i = 0; i < elements.length; i++) {
            var element = elements[i];           // Single path element
            var cmd = element.charAt(0);         // The command letter
            var args = element.match(svgnumber); // The numeric arguments
            var numbers = [];                    // To hold parsed args
            if (args) {  // The z command has no arguments
                for(var j = 0; j < args.length; j++)
                    numbers[j] = Number(args[j]);    // Convert args to numbers
            }
            // Command letters are all method names
            this[cmd].apply(this, numbers);
        }
        return this;
    }

    /*
     * SVG path commands
     * Many of these functions also work as extended canvas methods.
     * M and L, for example are compatible with moveTo and lineTo
     */

    // Absolute lineto
    function L(x,y) {
        check(arguments, 0, 2, 2);
        ensure(this,x,y); // not SVG: for compatiblity with canvas API
        this._.lineTo(x,y);
        for(var i = 2; i < arguments.length; i += 2)
            this._.lineTo(x = arguments[i], y = arguments[i+1]);
        setcurrent(this, x, y);
        return this;
    }
    // Relative lineto
    function l(x,y) {
        check(arguments, 0, 2, 2);
        checkcurrent(this);
        var cx = this.currentX, cy = this.currentY;
        for(var i = 0; i < arguments.length; i += 2)
            this._.lineTo(cx += arguments[i], cy += arguments[i+1]);
        setcurrent(this,cx,cy);
        return this;
    }

    // Absolute moveto
    function M(x,y) {
        this._.moveTo(x,y);
        setcurrent(this, x, y);
        this.startSubpathX = x;
        this.startSubpathY = y;
        if (arguments.length > 2) L.apply(this, slice(arguments,2));
        return this;
    }
    // Relative moveto
    function m(x,y) {
        if (this._pathIsEmpty) {
            // From the SVG spec: "If a relative moveto (m) appears as
            // the first element of the path, then it is treated as a
            // pair of absolute coordinates."
            this.currentX = 0; this.currentY = 0;
        }
        checkcurrent(this);

        x += this.currentX;
        y += this.currentY;

        this._.moveTo(x,y);
        setcurrent(this, x, y);
        this.startSubpathX = x;
        this.startSubpathY = y;
        if (arguments.length > 2) l.apply(this, slice(arguments,2));
        return this;
    }

    // Closepath
    function z() {
        this._.closePath();
        setcurrent(this, this.startSubpathX, this.startSubpathY);
        return this;
    }

    function H(x) {
        checkcurrent(this);
        for(var i = 0; i < arguments.length; i++) 
            L.call(this, arguments[i], this.currentY);
        return this;
    }
    function h(x) {
        for(var i = 0; i < arguments.length; i++) 
            l.call(this, arguments[i], 0);
        return this;
    }
    function V(y) {
        checkcurrent(this);
        for(var i = 0; i < arguments.length; i++) 
            L.call(this, this.currentX, arguments[i]);
        return this;
    }
    function v(y) {
        for(var i = 0; i < arguments.length; i++) 
            l.call(this, 0, arguments[i]);
        return this;
    }
    function C(cx1,cy1,cx2,cy2,x,y) {
        check(arguments, 0, 6, 6);
        ensure(this,cx1,cx2); // not SVG: for compatiblity with canvas API
        this._.bezierCurveTo(cx1,cy1,cx2,cy2,x,y);
        for(var i = 6; i < arguments.length; i+=6)  // polycurves
            this._.bezierCurveTo(arguments[i], arguments[i+1],
                                 cx2 = arguments[i+2], cy2 = arguments[i+3],
                                 x = arguments[i+4], y = arguments[i+5]);
        setcurrent(this, x, y);
        this._lastCCP = [cx2, cy2];
        return this;
    }
    function c(cx1,cy1,cx2,cy2,x,y) {
        check(arguments, 0, 6, 6);
        checkcurrent(this);
        var x0 = this.currentX, y0 = this.currentY;
        for(var i = 0; i < arguments.length; i+=6)   // polycurves
            this._.bezierCurveTo(x0 + arguments[i],
                                 y0 + arguments[i+1],
                                 cx2 = x0 + arguments[i+2],
                                 cy2 = y0 + arguments[i+3],
                                 x0 += arguments[i+4],
                                 y0 += arguments[i+5]);
        setcurrent(this,x0,y0);
        this._lastCCP = [cx2,cy2];
        return this;
    }
    function Q(cx,cy,x,y) {
        check(arguments, 0, 4, 4);
        ensure(this,cx,cy); // not SVG: canvas API compatibility
        this._.quadraticCurveTo(cx,cy,x,y);
        for(var i = 4; i < arguments.length; i+=4) 
            this._.quadraticCurveTo(cx=arguments[i], cy=arguments[i+1],
                                    x=arguments[i+2], y=arguments[i+3]);
        setcurrent(this,x,y);
        this._lastQCP = [cx, cy];
        return this;
    }
    function q(cx,cy,x,y) {
        check(arguments, 0, 4, 4);
        checkcurrent(this);
        var x0 = this.currentX, y0 = this.currentY;
        for(var i = 0; i < arguments.length; i+=4) 
            this._.quadraticCurveTo(cx = x0 + arguments[i],
                                    cy = y0 + arguments[i+1],
                                    x0 += arguments[i+2],
                                    y0 += arguments[i+3]);
        setcurrent(this,x0,y0);
        this._lastQCP = [cx,cy];
        return this;
    }
    function S(/*cx2,cy2,x,y*/) {            // Smooth bezier curve
        check(arguments, 0, 4, 4);
        if (!this._lastCCP)
            throw new Error("Last command was not a cubic bezier");
        checkcurrent(this);
        var x0 = this.currentX, y0 = this.currentY;
        var cx0 = this._lastCCP[0], cy0 = this._lastCCP[1];
        for(var i = 0; i < arguments.length; i+=4) {
            var cx1 = x0 + (x0-cx0), cy1 = y0 + (y0-cy0);
            var cx2 = arguments[i], cy2 = arguments[i+1];
            var x = arguments[i+2], y = arguments[i+3];
            this._.bezierCurveTo(cx1,cy1,cx2,cy2,x,y);
            x0 = x; y0 = y; cx0 = cx2; cy0 = cy2;
        }
        setcurrent(this,x0,y0);
        this._lastCCP = [cx0,cy0];
        return this;
    }
    function s(/*cx2,cy2,x,y*/) { 
        check(arguments, 0, 4, 4);
        if (!this._lastCCP)
            throw new Error("Last command was not a cubic bezier");
        checkcurrent(this);
        var x0 = this.currentX, y0 = this.currentY;
        var cx0 = this._lastCCP[0], cy0 = this._lastCCP[1];
        for(var i = 0; i < arguments.length; i+=4) {
            var cx1 = x0 + (x0-cx0), cy1 = y0 + (y0-cy0);
            var cx2 = x0+arguments[i], cy2 = y0+arguments[i+1];
            var x = x0+arguments[i+2], y = y0+arguments[i+3];
            this._.bezierCurveTo(cx1,cy1,cx2,cy2,x,y);
            x0 = x; y0 = y; cx0 = cx2; cy0 = cy2;
        }
        setcurrent(this,x0,y0);
        this._lastCCP = [cx0,cy0];
        return this;
    }
    function T(/*x,y*/) {
        check(arguments, 0, 2, 2);
        if (!this._lastQCP)
            throw new Error("Last command was not a cubic bezier");
        checkcurrent(this);
        var x0 = this.currentX, y0 = this.currentY;
        var cx0 = this._lastQCP[0], cy0 = this._lastQCP[1];
        for(var i = 0; i < arguments.length; i+=2) {
            var cx = x0 + (x0-cx0), cy = y0 + (y0-cy0);
            var x = arguments[i], y = arguments[i+1];
            this._.quadraticCurveTo(cx,cy,x,y);
            x0 = x; y0 = y; cx0 = cx; cy0 = cy;
        }
        setcurrent(this,x0,y0);
        this._lastQCP = [cx0,cy0];
        return this;
    }
    function t(/*x,y*/) {
        check(arguments, 0, 2, 2);
        if (!this._lastQCP)
            throw new Error("Last command was not a cubic bezier");
        checkcurrent(this);
        var x0 = this.currentX, y0 = this.currentY;
        var cx0 = this._lastQCP[0], cy0 = this._lastQCP[1];
        for(var i = 0; i < arguments.length; i+=2) {
            var cx = x0 + (x0-cx0), cy = y0 + (y0-cy0);
            var x = x0 + arguments[i], y = y0 + arguments[i+1];
            this._.quadraticCurveTo(cx,cy,x,y);
            x0 = x; y0 = y; cx0 = cx; cy0 = cy;
        }
        setcurrent(this,x0,y0);
        this._lastQCP = [cx0,cy0];
        return this;
    }

    // Draw an ellipse segment from the current point to (x,y)
    // XXX: is this supposed to allow multiple arcs in a single call?
    function A(rx,ry,rotation,big,clockwise,x,y) {
        // This math is from Appendix F, Implementation Notes of 
        // the SVG specification.  See especially F.6.5.
        // http://www.w3.org/TR/SVG/implnote.html#ArcImplementationNotes

        // If either radius is 0, then just do a straight line
        if (rx === 0 || ry === 0) {
            L.call(this, x, y);
            return this;
        }

        // Convert the flags to their boolean equivalents
        big = Boolean(big);
        clockwise = Boolean(clockwise);

        checkcurrent(this);
        var x1 = this.currentX, y1 = this.currentY;  // start point of arc
        var x2 = x, y2 = y;                          // end point of arc

        // SVG specifies angles in degrees.  Convert to radians
        // and precompute some trig.
        var phi = rotation * pi / 180;
        var sinphi = sin(phi);
        var cosphi = cos(phi);

        // Now, using the formulae in F.6.5 we compute the center point
        // (cx,cy) of the ellipse along with the start angle theta1
        // and the end angle theta2.  The variable names below use $
        // instead of ' as a prime marker

        // F.6.5.1: Step 1: compute(x1$, y1$)
        var tx = (x1 - x2)/2, ty = (y1-y2)/2;
        var x1$ =  cosphi * tx + sinphi * ty;
        var y1$ = -sinphi * tx + cosphi * ty;

        // F.6.6: Step 1.5: correct radii if necessary: 
        rx = abs(rx);  // F.6.6.1
        ry = abs(ry);
        var lambda = x1$*x1$/(rx*rx) + y1$*y1$/(ry*ry); // F.6.6.2
        var cx$, cy$;
        if (lambda > 1) { 
            // If this value is > 1, then the radii need to be adjusted
            // and we can skip step 2 below
            rx *= sqrt(lambda);
            ry *= sqrt(lambda);
            cx$ = cy$ = 0;
        }
        else {
            // F.6.5.2: Step 2: Compute (cx$, cy$): 
            // The radii weren't adjusted and we have to compute this
            var rxrx = rx*rx;
            var ryry = ry*ry;
            var x1x1$ = x1$*x1$;
            var y1y1$ = y1$*y1$;
            var t = rxrx*y1y1$ + ryry*x1x1$;
            t = sqrt(rxrx*ryry/t -1);
            if (big === clockwise) t = -t;
            cx$ = t*rx*y1$/ry;
            cy$ = -t*ry*x1$/rx;
        }

        // F.6.5.3: Step 3: compute (cx, cy)
        var cx = cosphi*cx$ - sinphi*cy$ + (x1+x2)/2;
        var cy = sinphi*cx$ + cosphi*cy$ + (y1+y2)/2;

        // F.6.5.4: Step 4: compute theta1 and theta2
        tx = (x1$-cx$)/rx;
        ty = (y1$-cy$)/ry;
        var theta1 = angleBetweenVectors(1,0,tx,ty);   // F.6.5.5
        var dtheta = angleBetweenVectors(tx,ty,        // F.6.5.6
                                          (-x1$-cx$)/rx, (-y1$-cy$)/ry);
        if (clockwise && dtheta < 0) dtheta += twopi;
        else if (!clockwise && dtheta > 0) dtheta -= twopi;

        var theta2 = theta1 + dtheta;

        // Now after all that computation, we can implement the SVG
        // A command using an extension of the canvas arc() method
        // that allows stretching and rotation
        var olddegrees = this._useDegrees;
        this._useDegrees = false;
        this.ellipse(cx, cy, rx, ry, phi, theta1, theta2, !clockwise);
        this._useDegrees = olddegrees;
        return this;
    }

    function a(rx,ry,rotation,big,clockwise,x,y) {
        checkcurrent(this);
        A.call(this,rx,ry,rotation,big,clockwise,
                   x + this.currentX, y + this.currentY);
        return this;
    }

    /*
     * More path-related commands that are not part of SVG
     */
    function beginPath() {
        this._.beginPath();
        setcurrent(this, undefined, undefined);
        this.startSubpathX = this.startSubpathY = undefined;
        this._pathIsEmpty = true;
        return this;
    }

    // Canvas arcTo command, with extra math to track the current point
    function arcTo(x1,y1,x2,y2,r) {
        ensure(this,x1,y1);
        checkcurrent(this);
        this._.arcTo(x1,y1,x2,y2,r);

        // XXX
        // Add code to handle the degenerate case: if P0==P1 or 
        // P1==P2 or r==0, then this is just a straight line
        // and the current point is just (x1,y1)

        // Do some math to compute the current point here
        // Definitions: 
        //   P0 is the current point (x0,y0)
        //   P1 is (x1,y1)
        //   P2 is (x2,y2)
        var x0 = this.currentX, y0 = this.currentY;

        // Compute the angle between the two lines
        // Take the absolute value to ignore the sign.  
        // The result will be between 0 and pi
        var dx1 = x0-x1, dy1 = y0-y1;  // Vector from P1 to P0
        var dx2 = x2-x1, dy2 = y2-y1;  // Vector from P1 to P2
        var theta = abs(angleBetweenVectors(dx1, dy1, dx2, dy2));

        // Now compute distance d of the current point along the line P1-P2 
        var d = r*tan((pi-theta)/2);

        // What porportion of the entire line length is that?
        var ratio = d/sqrt(dx2*dx2 + dy2*dy2);
        
        // The current point lies that far along the line P1-P2
        setcurrent(this, x1 + ratio*dx2, y1 + ratio*dy2);

        return this;
    }

    // Canvas arc function, with the last three arguments made optional
    function arc(x,y,r,sa,ea,anticlockwise) {
        if (anticlockwise === undefined) anticlockwise = false;
        if (sa === undefined) sa = 0;
        else sa = convertAngle(this,sa);
        if (ea === undefined) ea = twopi;
        else ea = convertAngle(this,ea);

        var sx = x + r*cos(sa), sy = y + r*sin(sa);   // start point
        var ex = x + r*cos(ea), ey = y + r*sin(ea);   // end point
        ensure(this,sx,sy);
        this._.arc(x,y,r,sa,ea,anticlockwise);
        setcurrent(this, ex, ey);
        return this;
    }

    // A generalization of the arc command above to allow x and y radii
    // and to allow rotation.  (The SVG A command uses this)
    function ellipse(cx,cy,rx,ry,rotation,sa,ea,anticlockwise) {
        if (rotation === undefined) rotation = 0;
        else rotation = convertAngle(this,rotation);
        if (sa === undefined) sa = 0;
        else sa = convertAngle(this,sa);
        if (ea === undefined) ea = twopi;
        else ea = convertAngle(this,ea);
        if (anticlockwise === undefined) anticlockwise = false;

        // compute the start and end points
        var sp = rotatePoint(rx*cos(sa), ry*sin(sa), rotation);
        var sx = cx + sp[0], sy = cy + sp[1];
        var ep = rotatePoint(rx*cos(ea), ry*sin(ea), rotation);
        var ex = cx + ep[0], ey = cy + ep[1];
        ensure(this,sx,sy);

        this._.translate(cx,cy);
        this._.rotate(rotation);
        this._.scale(rx/ry,1);
        this._.arc(0,0,ry,sa,ea,anticlockwise);
        this._.scale(ry/rx,1);
        this._.rotate(-rotation);
        this._.translate(-cx,-cy);

        setcurrent(this,ex,ey);
        return this;
    }

    function polygon() {
        // Need at least 3 points for a polygon
        if (arguments.length < 6) throw new Error("not enough arguments");

        if (arguments.length %2 === 0) {
            this.moveTo(arguments[0], arguments[1]);
            for(var i = 2; i < arguments.length; i+=2)
                this.lineTo(arguments[i], arguments[i+1]);
        }
        else {
            // If the number of args is odd, then the last is corner radius
            var radius = arguments[arguments.length-1];
            var n = (arguments.length-1)/2;

            // Begin at the midpoint of the first and last points
            var x0 = (arguments[n*2-2] + arguments[0])/2;
            var y0 = (arguments[n*2-1] + arguments[1])/2;
            this.moveTo(x0,y0);
            // Now arcTo each of the remaining points
            for(var i = 0; i < n-1; i++) {
                this._.arcTo(arguments[i*2], arguments[i*2+1],
                             arguments[i*2+2], arguments[i*2+3],
                             radius);
            }
            // Final arcTo back to the start
            this._.arcTo(arguments[n*2-2], arguments[n*2-1],
                         arguments[0], arguments[1], radius);
        }

        this.closePath();
        this.moveTo(arguments[0], arguments[1]);
        return this;
    }

    function rect(x,y,w,h,radius,rotation) {
        if (arguments.length === 4) { // square corners, no rotation
            this._.rect(x,y,w,h);
            setcurrent(this, x, y);
            this.startSubpathX = x;
            this.startSubpathY = y;
        }
        else {
            if (!rotation) {  // Rounded corners, no rotation
                polygon.call(this, x, y, x+w, y, x+w, y+h, x, y+h, radius);
            }
            else {            // Rotation with or without rounded corners
                rotation = convertAngle(this, rotation);
                var points = [x,y];
                var p = rotatePoint(w, 0, rotation);
                points.push(x+p[0], y+p[1]);
                p = rotatePoint(w, h, rotation);
                points.push(x+p[0], y+p[1]);
                p = rotatePoint(0, h, rotation);
                points.push(x+p[0], y+p[1]);
                if (radius) points.push(radius);
                polygon.apply(this, points);
            }
        }
        // The polygon() method handles setting the current point
        return this;
    }

    /*
     * Drawing functions
     */
    function stroke() {
        if (arguments.length > 0) {       // If any arguments
            this._.save();                // save current state
            this.set.apply(this, arguments);   // set drawing attributes
        }
        this._.stroke();
        if (arguments.length > 0)
            this._.restore();             // restore original state
        return this;
    }

    function fill() {
        if (arguments.length > 0) {       // If any arguments
            this._.save();                // save current state
            this.set.apply(this, arguments);   // set drawing attributes
        }
        this._.fill();
        if (arguments.length > 0)
            this._.restore();             // restore original state
        return this;
    }

    function paint() {
        if (arguments.length > 0) {       // If any arguments
            this._.save();                // save current state
            this.set.apply(this, arguments);   // set drawing attributes
        }
        this._.fill();
        this._.stroke();
        if (arguments.length > 0)
            this._.restore();             // restore original state
        return this;
    }

    function fillRect(x,y,w,h) {
        if (arguments.length > 4) {
            this._.save();
            this.set.apply(this, slice(arguments,4));
        }
        this._.fillRect(x,y,w,h);
        if (arguments.length > 4) this._.restore();
        return this;
    }

    function strokeRect(x,y,w,h) {
        if (arguments.length > 4) {
            this._.save();
            this.set.apply(this, slice(arguments,4));
        }
        this._.strokeRect(x,y,w,h);
        if (arguments.length > 4) this._.restore();
        return this;
    }

    function paintRect(x,y,w,h) {
        if (arguments.length > 4) {
            this._.save();
            this.set.apply(this, slice(arguments,4));
        }
        this._.fillRect(x,y,w,h);
        this._.strokeRect(x,y,w,h);
        if (arguments.length > 4) this._.restore();
        return this;
    }

    /*
     * attribute setting, saving and restoring
     */
    function save() {
        this._.save();
        this._angleUnitStack.push(this._useDegrees);
        return this;
    }

    function restore() {
        this._.restore();
        this._useDegrees = this._angleUnitStack.pop();
        return this;
    }

    function revert() {
        this._.restore();
        this._.save();
        this._useDegrees = this._angleUnitStack[this._angleUnitStack.length-1];
        return this;
    }

    function set(attributes) {
        for(var i = 0; i < arguments.length; i++) {
            var arg = arguments[i];
            if (typeof arg === "string") {
                // String arguments name an attribute and must be followed
                // by a value.
                i++;
                if (i >= arguments.length)
                    throw new Error("missing attribute value");
                this[arg] = arguments[i];
            }
            else {
                // Otherwise, assume an object of name/value pairs
                for(var attr in arg) this[attr] = arg[attr];
            }
        }

        return this;
    }


    /*
     * Turtle graphics.
     */
    // Pen Up
    function pu() { this._penup = true; return this;}

    // Pen Down
    function pd() { this._penup = false; return this;}
        
    // Forward
    function fd(d) {
        var dx = d*cos(this._orientation);
        var dy = d*sin(this._orientation);
        if (this._penup) this.m(dx,dy);
        else this.l(dx,dy);
        return this;
    }

    // Back
    function bk(d) {
        var dx = -d*cos(this._orientation);
        var dy = -d*sin(this._orientation);
        if (this._penup) this.m(dx,dy);
        else this.l(dx,dy);
        return this;
    }

    // Right turn
    function rt(angle) {
        this._orientation += convertAngle(this,angle);
        this._orientation %= twopi;
        return this;
    }

    // Left turn
    function lt(angle) {
        this._orientation += convertAngle(this,angle);
        this._orientation %= twopi;
        return this;
    }

    /*
     * Transformations
     *
     * XXX: All of these functions lose track of the current point and
     *  subpath start point.  (To track those points properly would require
     *  special handling in save() and restore().)  So you can't use
     *  relative motion commands after doing a transformation and before
     *  establishing a new current point.  Also, a number of other 
     *  arc and curve commands require a current point
     */
    function translate(dx,dy) {
        this._.translate(dx,dy);
        this.currentX = this.currentY = undefined;
        this.startSubpathX = this.startSubpathY = undefined;
        return this;
    }

    function scale(x,y) {
        this._.scale(x,y);
        this.currentX = this.currentY = undefined;
        this.startSubpathX = this.startSubpathY = undefined;
        return this;
    }

    function rotate(angle) {
        angle = convertAngle(this,angle);
        this._.rotate(angle);
        this.currentX = this.currentY = undefined;
        this.startSubpathX = this.startSubpathY = undefined;
        return this;
    }

    function transform() {
        this._.transform.apply(this._, arguments);
        this.currentX = this.currentY = undefined;
        this.startSubpathX = this.startSubpathY = undefined;
        return this;
    }

    function setTransform() {
        this._.setTransform.apply(this._, arguments);
        this.currentX = this.currentY = undefined;
        this.startSubpathX = this.startSubpathY = undefined;
        return this;
    }

    function createPattern(image, repeat) {
        return this._.createPattern(getImage(image), repeat);
    }

    function createLinearGradient(x1,y1,x2,y2) {
        var gradient = this._.createLinearGradient(x1,y1,x2,y2);
        addColorStops(gradient, slice(arguments, 4));
        return gradient;
    }

    function createRadialGradient(x1,y1,r1,x2,y2,r2) {
        var gradient = this._.createRadialGradient(x1,y1,r1,x2,y2,r2);
        addColorStops(gradient, slice(arguments, 6));
        return gradient;
    }

    /*
     * Text methods 
     */

    function textWidth(text) { return this._.measureText(text).width; }
    
    function fillText(text, x, y, maxWidth) {
        var attrs = null, hasMaxWidth = true;
        if (typeof maxWidth !== "number") {
            hasMaxWidth = false;
            if (arguments.length > 3) attrs = slice(arguments, 3);
        }
        else if (arguments.length > 4) attrs = slice(arguments, 4);
        
        if (attrs) {
            this._.save();
            this.set.apply(this, attrs);
        }

        if (hasMaxWidth) this._.fillText(text, x, y, maxWidth);
        else this._.fillText(text, x, y);

        if (attrs) this._.restore();
        return this;
    }

    function strokeText(text, x, y, maxWidth) {
        var attrs = null, hasMaxWidth = true;
        if (typeof maxWidth !== "number") {
            hasMaxWidth = false;
            if (arguments.length > 3) attrs = slice(arguments, 3);
        }
        else if (arguments.length > 4) attrs = slice(arguments, 4);
        
        if (attrs) {
            this._.save();
            this.set.apply(this, attrs);
        }

        if (hasMaxWidth) this._.strokeText(text, x, y, maxWidth);
        else  this._.strokeText(text, x, y);

        if (attrs) this._.restore();
        return this;
    }

    /*
     * Image methods
     */
    function drawImage(image) {
        // convert string to image, if need be, and separate numeric 
        // arguments from attribute arguments
        var args = [getImage(image)],    // The image and numbers
        attrs = null;                // any attributes
        for(var i = 1; i < arguments.length; i++) {
            if (typeof arguments[i] === "number")
                args.push(arguments[i]);    
            else break;
        }
        if (i < arguments.length) attrs = slice(arguments, i);

        if (attrs) {                           // Apply attributes
            this._.save();
            this.set.apply(this, attrs);
        }
        this._.drawImage.apply(this._, args);  // Draw the image
        if (attrs) this._.restore();           // Retore attributes
    }

    // Setting a canvas size clears and resets its state
    function reset() {
        this._.canvas.width = this._.canvas.width;
        resetCantoState(this);
    }

    // Make canvas.toDataURL a method of the context, too
    function toDataURL() {
        return this._.canvas.toDataURL.apply(this._.canvas, arguments);
    }


    /**
     * The constructor for the Canto class.
     * This constructor is private and is not exported.  Use the canto() 
     * factory function instead.
     * @constructor
     * @private
     */
    function Canto(canvas) {
        if (!canvas.getContext)
            throw new Error("canto() requires a canvas element or id");

        // Store the 2D context that we wrap using the obscure property name _
        this._ = canvas.getContext("2d");
        resetCantoState(this);
    }

    Canto.prototype = {
        constructor: canto,
        
        /*
         * Path building commands
         */

        /**
         * Just like the 2D beginPath method, but chainable.
         */
        beginPath: beginPath, 

        /**
         * The endPath() method is another name for beginPath(); it is often
         * more useful call this method when you are done with a path instead
         * of calling it when beginning a new one.
         */
        endPath: beginPath,  // A more logical name for it

        /**
         * Just like the 2D closePath method, but chainable. Alias: z()
         */
        closePath: z,

        /**
         * This method is compatible with the 2D moveTo() method and the
         * SVG M command. If you specify the coordinates of more than one 
         * point, then this method behaves as if you'd passed the additional
         * commands to lineTo().  Alias: M().
         */
        moveTo: M,
        
        /**
         * This method works like moveTo(), but uses relative coordinates.
         * If there is no current point, then the first set of coordinates
         * are taken to be absolute.  Alias: m().
         */
        rmoveTo: m,
        
        /**
         * This method is compatible with the 2D lineTo() method and the
         * svg L command.  You may pass the coordinates of multiple points
         * in a single call to specify a polyline.  Alias: L().
         */
        lineTo: L,

        /**
         * This method works like lineTo(), but uses relative coordinates.
         */
        rlineTo: l,

        /**
         * This method is compatible with the 2D quadraticCurveTo() method
         * and the SVG Q command. You may pass the coordinates of multiple
         * curves in a single call.  Alias: Q().
         */
        quadraticCurveTo: Q,

        /**
         * This method is like quadraticCurveTo(), but uses relative
         * coordinates.  Alias q()
         */
        rquadraticCurveTo: q,

        /**
         * This method is compatible with the 2D bezierCurveTo() method
         * and the SVG C command. You may pass the coordinates of multiple
         * curves in a single call.  Alias: C().
         */
        bezierCurveTo: C, 

        /**
         * This method is like bezierCurveTo(), but uses relative
         * coordinates.  Alias c()
         */
        rbezierCurveTo: c,

        /**
         * This method works just like the 2D arcTo() method but is chainable.
         */
        arcTo: arcTo,

        /**
         * This method works like the 2D arc() method, but is
         * chainable and the last three arguments are optional.  If
         * omitted, the start angle is 0, the end angle is 2pi, and
         * the arc direction is clockwise.
         */
        arc: arc,
        
        /**
         * This method is a generalization of the 2D arc() method to draw
         * elliptical arcs as well as circular arcs.
         * @param {number} cx the X coordinate of the center of the ellipse
         * @param {number} cy the Y coordinate of the center of the ellipse
         * @param {number} rx the X radius of the ellipse
         * @param {number} ry the Y radius of the ellipse
         * @param {number=} rotation the clockwise rotation about (cx,cy).
         *       The default is 0.
         * @param {number=} sa the start angle; defaults to 0
         * @param {number=} ea the end angle; defaults to 2pi
         * @param {boolean=} anticlockwise: the arc direction. The default
         *        is false, which means clockwise
         */
        ellipse: ellipse,

        /**
         * This method is a chainable generalization of the 2D rect() method.
         * With 4 arguments, it works just like the 2D method. An optional
         * 5th argument specifies a radius for rounded corners. An optional
         * 6th argument specifies a clockwise rotation about (x,y).
         * Sets the current point to (x,y).
         */
        rect: rect,
        
        /**
         * This method connects the specified points as a polygon.  It requires
         * at least 6 arguments (the coordinates of 3 points).  If an odd 
         * number of arguments are passed, the last one is taken as a corner
         * radius.
         */
        polygon: polygon,


        // Svg commands

        /**
         * This method takes a string argument that describes a path using
         * the syntax of the d attribute of the SVG <path> element. It parses
         * that string and defines the path.
         */
        svgpath: svgpath,

        /** @see #moveTo */
        M: M,
        /** @see #rmoveTo */
        m: m,
        /** @see #lineTo */
        L: L,
        /** @see #rlineTo */
        l: l,
        /**
         * Draws a horizontal line from the current point to the
         * specified X coordinate.
         */
        H: H,
        /** Draws a horizontal line using relative coordinates */
        h: h,
        /**
         * Draws a vertical line from the current point to the
         * specified Y coordinate.
         */
        V: V,
        /** Draws a vertical line using relative coordinates */
        v: v,
        /** @see #bezierCurveTo */
        C: C, 
        /** @see #rbezierCurveTo */
        c: c,
        /** 
         * The SVG S path element: adds another cubic bezier to the path, 
         * using the reflection of the last cubic control point as the
         * first control point for this curve. Only valid if the last 
         * path segment was a C, c, S, or s.
         */
        S: S,
        /** The relative-coordinate version of S(). */
        s: s,
        /** @see #quadraticCurveTo */
        Q: Q,
        /** @see #rquadraticCurveTo */
        q: q,
        /** 
         * The SVG T path element: adds another quadratic bezier to the path, 
         * using the reflection of the last quadratic control point as the
         * control point for this curve. Only valid if the last path segment
         * was a Q, q, T or t.
         */
        T: T,
        /** The relative-coordinate version of T */
        t: t,
        /**
         * The SVG A path element: connects the current point to the point
         * specified by the last two arguments with the portion of an ellipse
         * specified by the other arguments.  See the SVG spec for details
         * of this complicated command.
         */
        A: A,
        /** The relative-coordinate version of a */
        a: a,
        /** @see #closePath */
        Z: z,
        /** @see #closePath */
        z: z,


        /*
         * Turtle graphics commands
         */

        /** 
         * Turtle-graphics: lift the pen.  Subsequent forward and back calls
         * will call moveTo instead of lineTo.  Alias: pu
         */
        penUp: pu,
        /** @see penUp */
        pu: pu,
        /**
         * Turtle-graphics: lower the pen.  Subsequent forward and back calls
         * will call lineTo instead of moveTo.  Alias: pd
         */
        penDown: pd,
        /** @see penDown */
        pd: pd,
        /**
         * Turtle graphics: move the specified distance in the current 
         * direction.  Alias: fd
         */
        forward: fd,
        /** @see #forward */
        fd: fd,
        /**
         * Turtle graphics: move the specified distance in the direction 
         * opposition the current direction.  Alias: bk
         */
        back: bk,
        /** @see #back */
        bk: bk,
        /**
         * Rotate the current direction clockwise by the specified angle.
         * The angleUnit attribute specifies whether angles are measured
         * in radians (the default) or degrees 
         */
        right: rt,
        /** @see #right */
        rt: rt,
        
        /**
         * Rotate the current direction anticlockwise by the specified angle.
         * The angleUnit attribute specifies whether angles are measured
         * in radians (the default) or degrees 
         */
        left: lt,

        /** @see #left */
        lt: lt,

        /*
         * attribute setting, saving and restoring
         */

        /** Just like the 2D save() method */
        save: save,
        /** Just like the 2D restore() method */
        restore: restore,
        /**
         * Reverts the graphics attributes to their state at the time of the
         * last save(), without popping the stack.  Equivalent to calling
         * restore() and then immediately calling save()
         */
        revert: revert,

        /**
         * Set the graphics state attributes specified by the arguments.
         * Any number of arguments may be passed.  If an argument is a string
         * then it is taken as the name of an attribute and the next argument
         * is taken as its value. If an argument is an object, then its
         * properties are assumed to be attribute name/value pairs.
         */
        set: set,

        /*
         * Drawing functions
         */


        /**
         * Like the 2D stroke() method, but chainable, and accepts any number
         * of graphical attribute arguments, which will be temporarily set
         * before the stroke is performed. The arguments are the same
         * as the set() method.
         */
        stroke: stroke,

        /**
         * Like the 2D fill() method, but chainable, and accepts any number
         * of graphical attribute arguments, which will be temporarily set
         * before the stroke is performed. The arguments are the same
         * as the set() method.
         */
        fill: fill,

        /**
         * This method fills and then strokes the current path.  It accepts
         * temporary graphics attribute arguments like stroke() and fill() do.
         */
        paint: paint,

        /**
         * Like the 2D clip() method, but chainable 
         */
        clip: wrapAndReturn("clip"),

        /**
         * Like the 2D clearRect() method, but chainable 
         */
        clearRect: wrapAndReturn("clearRect"),

        /**
         * This method is like the 2D fillRect() method, but is chainable and
         * accepts optional arguments after the 4 rectangle coordinates that
         * specify graphical attributes to be applied temporarily.
         */
        fillRect: fillRect,

        /**
         * This method is like the 2D strokeRect() method, but is chainable and
         * accepts optional arguments after the 4 rectangle coordinates that
         * specify graphical attributes to be applied temporarily.
         */
        strokeRect: strokeRect,

        /**
         * This method fills and then strokes the specified rectangle.
         * It accepts optional arguments after the 4 rectangle coordinates that
         * specify graphical attributes to be applied temporarily.
         */
        paintRect: paintRect,

        /*
         * Transformations
         */
        /** Like the 2D method, but chainable */
        translate: translate,
        /** Like the 2D method, but chainable */
        scale: scale,
        /** Like the 2D method, but chainable */
        rotate: rotate,


        // XXX:
        // this method does not correctly update the current point
        // or the start of the subpath, so don't call it after defining
        // a path and before calling anything that depends on relative motion
        // In order to implement this completely, I'd have to invert
        // the matrix.

        /**
         * Like the 2D transform()  method, but chainable.
         * Caution: this method does not update canto's current point.
         * After calling this method you must define an absolute path segment
         * (with moveTo(), lineTo(), e.g.) before you can use any relative
         * path segment commands (such as rlineTo()).
         */
        transform: transform,

        // XXX:
        // this method does not correctly update the current point
        // or the start of the subpath, so don't call it after defining
        // a path and before calling anything that depends on relative motion
        // In order to completely implement this, I'd have to know the current
        // transformation matrix, which I don't.

        /**
         * Like the 2D setTransform()  method, but chainable.
         * Caution: this method does not update canto's current point.
         * After calling this method you must define an absolute path segment
         * (with moveTo(), lineTo(), e.g.) before you can use any relative
         * path segment commands (such as rlineTo()).
         */
        setTransform: setTransform,

        /*
         * Patterns and gradients
         */

        /**
         * This method is like the 2D createPattern() method
         * but allows the pattern image to be specified as a string.  If the
         * first argument is a string that begins with '#' it is taken as
         * an element id. If the argument is any other string, it is taken
         * as the URL of an image.
         */
        createPattern: createPattern,

        /**
         * This method is like the 2D createLinearGradient but allows any 
         * number of color stops to be passed at the end of the argument list
         * so that a gradient can be defined with a single expression without
         * having to call addColorStop() multiple times on the returned value.
         */
        createLinearGradient: createLinearGradient,

        /**
         * This method is like the 2D createRadialGradient but allows any 
         * number of color stops to be passed at the end of the argument list
         * so that a gradient can be defined with a single expression without
         * having to call addColorStop() multiple times on the returned value.
         */
        createRadialGradient: createRadialGradient,

        /*
         * Text methods 
         */

        /**
         * This method is like the 2D measureText() method.
         */
        measureText: wrap("measureText"),

        /**
         * This method calls measureText() on its argument and then returns
         * the width property of value returned by measureText().
         */
        textWidth: textWidth,

        /**
         * This method is like the 2D fillText() but is chainable, and takes
         * optional graphical attribute arguments like fill() does.
         */
        fillText: fillText,

        /**
         * This method is like the 2D strokeText() but is chainable, and takes
         * optional graphical attribute arguments like fill() does.
         */
        strokeText: strokeText,

        /*
         * Image methods
         */

        /**
         * This method is like the 2D drawImage() method but is chainable
         * allows the image to be specified as a string, and accepts optional
         * graphical attribute arguments.  If the first argument is a string
         * it is taken as an element id if it begins with # or as an image URL
         * otherwise. Any arguments after the image coordinates are taken
         * to be graphical attributes and are temporarily set before the
         * image is drawn.
         */
        drawImage: drawImage,

        /*
         * Pixel methods
         */
        /** Like the 2D method. */
        createImageData: wrap("createImageData"),
        /** Like the 2D method. */
        getImageData: wrap("getImageData"),
        /** Like the 2D method, but chainable */
        putImageData: wrapAndReturn("putImageData"),


        /*
         * Miscellaneous methods
         */

        /**
         * Clears and resets the graphical state of the canvas
         */
        reset: reset,

        /** 
         * This method just invokes the toDataURL() method of the canvas. 
         */
        toDataURL: toDataURL,

        /** Like the 2D method. */
        isPointInPath: wrap("isPointInPath"),
        /** Like the 2D method. */
        drawFocusRing: wrap("drawFocusRing"),

        /*
         * Other attributes
         */

        /** Readonly accessor for the canvas associated with this context */
        get canvas() { return this._.canvas; },

        /**
         * Getters and setters for width and height operate on the 
         * dimensions of the canvas.
         */
        get width() { return this._.canvas.width; },
        set width(x) { this._.canvas.width = x; },
        get height() { return this._.canvas.height; },
        set height(x) { this._.canvas.height = x; },


        /**
         * The canto object has an angleUnit property that specifies how
         * angles are measured. Legal values are "radians" (the default) and
         * "degrees". The value of this property affects the interpretation
         * of angles in the arc(), ellipse(), rotate(), left() and right()
         * methods, but does not affect the interpretation of angles in the 
         * SVG methods A(), a(), and svgpath(): SVG paths always measure
         * angles in degrees.  The state of this property is saved and
         * restored by save(), restore(), and revert().
         */
        get angleUnit() {
            if (this._useDegrees) return "degrees";
            else return "radians"
        },
        set angleUnit(x) {
            if (x === "radians") this._useDegrees = false;
            else if (x === "degrees") this._useDegrees = true;
            else throw new Error("Unsupported angle unit: " + x);
        },

        /**
         * Graphics attribute properties: just like the 2D attributes.
         * These are all saved and restored by save() and restore()
         */
        get fillStyle() { return this._.fillStyle; },
        set fillStyle(x) { this._.fillStyle = x; },
        get font() { return this._.font; },
        set font(x) { this._.font = x; },
        get globalAlpha() { return this._.globalAlpha; },
        set globalAlpha(x) { this._.globalAlpha = x; },
        get globalCompositeOperation(){return this._.globalCompositeOperation;},
        set globalCompositeOperation(x) {this._.globalCompositeOperation = x;},
        get lineCap() { return this._.lineCap; },
        set lineCap(x) { this._.lineCap = x; },
        get lineJoin() { return this._.lineJoin; },
        set lineJoin(x) { this._.lineJoin = x; },
        get lineWidth() { return this._.lineWidth; },
        set lineWidth(x) { this._.lineWidth = x; },
        get miterLimit() { return this._.miterLimit; },
        set miterLimit(x) { this._.miterLimit = x; },
        get shadowBlur() { return this._.shadowBlur; },
        set shadowBlur(x) { this._.shadowBlur = x; },
        get shadowColor() { return this._.shadowColor; },
        set shadowColor(x) { this._.shadowColor = x; },
        get shadowOffsetX() { return this._.shadowOffsetX; },
        set shadowOffsetX(x) { this._.shadowOffsetX = x; },
        get shadowOffsetY() { return this._.shadowOffsetY; },
        set shadowOffsetY(x) { this._.shadowOffsetY = x; },
        get strokeStyle() { return this._.strokeStyle; },
        set strokeStyle(x) { this._.strokeStyle = x; },
        get textAlign() { return this._.textAlign; },
        set textAlign(x) { this._.textAlign = x; },
        get textBaseline() { return this._.textBaseline; },
        set textBaseline(x) { this._.textBaseline = x; }
    };

    // Return the canto() factory function.
    // This is the entry point to the Canto library.
    return function canto(canvas) {
        if (typeof canvas === "string")
            canvas = document.getElementById(canvas);
        if (!canvas._$canto)
            canvas._$canto = new Canto(canvas);
        return canvas._$canto;
    };

}());
