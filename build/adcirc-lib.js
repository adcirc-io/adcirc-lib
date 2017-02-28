// https://github.com/atdyer/adcirc-lib Version 0.0.1. Copyright 2017 Tristan Dyer.
(function (global, factory) {
	typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
	typeof define === 'function' && define.amd ? define(['exports'], factory) :
	(factory((global.adcirc = global.adcirc || {})));
}(this, (function (exports) { 'use strict';

function file_reader ( file ) {

    var _file = file;
    var _file_size = file.size;
    var _reader = new FileReader();
    var _block_size = 4*256*256;    // ~1MB
    var _offset = 0;

    var _block_callback = function () {};
    var _continue_callback = function () { return true; };
    var _finished_callback = function () {};
    var _error_callback = function () {};

    var _r = function ( file ) {

        _file = file;
        _file_size = file.size;

    };

    _r.read = function () {
        read_block( _offset, _block_size, file );
        return _r;
    };

    _r.read_block = function ( start, end, cb ) {

        var block = _file.slice( start, end );
        _reader.onload = function ( dat ) {

            if ( dat.target.error !== null ) {
                _error_callback( dat.target.error );
                throw dat.target.error;
            }

            cb( dat.target.result );

        };
        _reader.readAsText( block );

    };

    _r.block_size = function ( _ ) {
        if ( !arguments.length ) return _block_size;
        _block_size = _;
        return _r;
    };

    _r.offset = function ( _ ) {
        if ( !arguments.length ) return _offset;
        _offset = _;
        return _r;
    };

    _r.block_callback = function ( _ ) {
        if ( !arguments.length ) return _block_callback;
        if ( typeof _ == 'function' ) _block_callback = _;
        return _r;
    };

    _r.continue_callback = function ( _ ) {
        if ( !arguments.length ) return _continue_callback;
        if ( typeof _ == 'function' ) _continue_callback = _;
        return _r;
    };

    _r.finished_callback = function ( _ ) {
        if ( !arguments.length ) return _finished_callback;
        if ( typeof _ == 'function' ) _finished_callback = _;
        return _r;
    };

    _r.error_callback = function ( _ ) {
        if ( !arguments.length ) return _error_callback;
        if ( typeof _ == 'function' ) _error_callback = _;
        return _r;
    };

    function read_block ( start_index, block_size, f ) {

        var block = f.slice( start_index, start_index + block_size );
        _reader.onload = parse_block;
        _reader.readAsText( block );

    }

    function parse_block ( block ) {

        if ( block.target.error !== null ) {
            _error_callback( block.target.error );
            throw block.target.error;
        }

        // Get the data
        var data = block.target.result;

        // Calculate offset for next read
        _offset += data.length;

        // Determine if there will be another read
        if ( _offset >= _file_size ) {

            // There won't so pass all of the data to the parsing callback
            _block_callback( data );

            // Now we're finished
            _finished_callback();

        } else {

            // There will, so pass the data to the parsing callback
            _block_callback( data );

            // Check that we should still continue
            if ( _continue_callback() ) {

                // We should, so read the next block
                read_block( _offset, _block_size, file );

            } else {

                // We shouldn't, so we're finished
                _finished_callback();

            }

        }

    }

    return _r;

}

var worker = function ( code ) {

    var blob_url = URL.createObjectURL( new Blob(
        [ code ],
        { type: 'application/javascript' } )
    );
    var worker = new Worker( blob_url );

    URL.revokeObjectURL( blob_url );

    return worker;

};

function build_fort14_worker () {

    var reader;
    var file_size;

    var blob_loc = 0;
    var file_loc = 0;

    var line = 0;
    var line_map = {};
    var line_part = '';

    var regex_line = /.*\r?\n/g;
    var regex_nonwhite = /\S+/g;

    var agrid;
    var info_line;
    var num_nodes;
    var num_elements;
    var min_x = Infinity, max_x = -Infinity;
    var min_y = Infinity, max_y = -Infinity;
    var min_z = Infinity, max_z = -Infinity;

    var node_array;
    var node_map = {};
    var element_array;
    var element_map = {};

    var nope;
    var neta;
    var nbou;
    var nvel;
    var elev_segments = [];
    var flow_segments = [];
    var segment_length = -1;
    var segment = [];

    var nodes_read = false;
    var elements_read = false;

    var on_nodes = [];
    var on_elements = [];

    var progress = 0;
    var progress_interval = 2;
    var next_progress = progress + progress_interval;

    self.addEventListener( 'message', function ( message ) {

        message = message.data;

        switch ( message.type ) {

            case 'read':

                file_size = message.file.size;

                post_start();

                reader = file_reader( message.file )
                    .block_callback( parse_data )
                    .finished_callback( done )
                    .error_callback( on_error )
                    .read();

                break;

            case 'get':

                if ( message.what === 'nodes' ) {
                    on_nodes.push( post_nodes );
                    check_queues();
                }

                if ( message.what === 'elements' ) {
                    on_elements.push( post_elements );
                    check_queues();
                }

                break;

        }

    });

    function check_queues () {

        var callback;

        // Check nodes queue
        if ( nodes_read && on_nodes.length ) {
            while ( ( callback = on_nodes.shift() ) !== undefined ) {
                callback();
            }
        }

        // Check elements queue
        if ( elements_read && on_elements.length ) {
            while ( ( callback = on_elements.shift() ) !== undefined ) {
                callback();
            }
        }

    }

    function done () {

        parse_data( '\n' );
        post_finish();
        check_queues();

    }

    function flatten ( map, type ) {

        var flat = [];
        for ( var key in map ) {
            if ( map.hasOwnProperty( key ) ) {
                flat.push( key, map[key] );
            }
        }

        return new type( flat );

    }

    function on_error ( error ) {

        post_error( error );

    }

    function parse_data ( data ) {

        // Reset the blob location
        blob_loc = 0;

        // Add any leftover line parts from the last parse
        data = line_part + data;

        // Perform matching
        var dat;
        var match;
        while ( ( match = regex_line.exec( data ) ) !== null ) {

            // Progress stuff
            if ( 100 * ( file_loc + match.index ) / file_size > next_progress ) {

                post_progress( next_progress );
                next_progress += progress_interval;

            }

            // Read the AGRID line
            if ( line == 0 ) {

                line_map[ 'agrid' ] = file_loc + match.index;
                agrid = match[0].trim();

            }

            // Read the mesh info line
            else if ( line == 1 ) {

                line_map[ 'info_line' ] = file_loc + match.index;
                info_line = match[0].trim();

                // Get the number of elements and nodes
                dat = info_line.match( regex_nonwhite );
                num_elements = parseInt( dat[0] );
                num_nodes = parseInt( dat[1] );

                // Allocate the arrays
                node_array = new Float32Array( 3 * num_nodes );
                element_array = new Uint32Array( 3 * num_elements );

            }

            else if ( line >= 2 && line < 2 + num_nodes ) {

                if ( line == 2 ) {
                    line_map[ 'nodes' ] = file_loc + match.index;
                }

                parse_node_line( match[0] );

            }

            else if ( line >= 2 + num_nodes && line < 2 + num_nodes + num_elements ) {

                nodes_read = true;

                if ( line == 2 + num_nodes ) {
                    line_map[ 'elements' ] = file_loc + match.index;
                }

                parse_element_line( match[0] );

            }

            else if ( nope === undefined ) {

                elements_read = true;

                line_map[ 'nope' ] = file_loc + match.index;

                dat = match[0].match( regex_nonwhite );
                nope = parseInt( dat[0] );

            }

            else if ( neta === undefined ) {

                line_map[ 'neta' ] = file_loc + match.index;

                dat = match[0].match( regex_nonwhite );
                neta = parseInt( dat[0] );

            }

            else if ( elev_segments.length == nope && nbou === undefined ) {

                line_map[ 'nbou' ] = file_loc + match.index;

                dat = match[0].match( regex_nonwhite );
                nbou = parseInt( dat[0] );

            }

            else if ( elev_segments.length == nope && nvel === undefined ) {

                line_map[ 'nvel' ] = file_loc + match.index;

                dat = match[0].match( regex_nonwhite );
                nvel = parseInt( dat[0] );

            }

            else if ( segment_length == -1 && ( elev_segments.length < nope || flow_segments.length < nbou ) ) {

                dat = match[0].match( regex_nonwhite );
                segment_length = parseInt( dat[0] );
                segment = [];

            }

            else if ( segment.length < segment_length ) {

                dat = match[0].match( regex_nonwhite );
                segment.push( parseInt( dat[0] ) );

                if ( segment.length == segment_length ) {

                    if ( elev_segments.length < nope ) {

                        elev_segments.push( segment );

                    }

                    else if ( flow_segments.length < nbou ) {

                        flow_segments.push( segment );

                    }

                    segment_length = -1;
                    segment = [];

                }

            }

            blob_loc = regex_line.lastIndex;
            line += 1;

        }

        line_part = data.slice( blob_loc );

        file_loc += blob_loc;

    }

    function parse_node_line ( str ) {

        var dat = str.match( regex_nonwhite );
        var nn = parseInt( dat[0] );
        var x = parseFloat( dat[1] );
        var y = parseFloat( dat[2] );
        var z = parseFloat( dat[3] );

        if ( x < min_x ) min_x = x;
        else if ( x > max_x ) max_x = x;
        if ( y < min_y ) min_y = y;
        else if ( y > max_y ) max_y = y;
        if ( z < min_z ) min_z = z;
        else if ( z > max_z ) max_z = z;

        var node_index = line - 2;
        node_array[ 3 * node_index ] = x;
        node_array[ 3 * node_index + 1 ] = y;
        node_array[ 3 * node_index + 2 ] = z;

        node_map[ nn ] = node_index;

    }

    function parse_element_line ( str ) {

        var dat = str.match( regex_nonwhite );
        var element_index = line - num_nodes - 2;
        var en = parseInt( dat[0] );
        element_array[ 3 * element_index ] = parseInt( dat[2] );
        element_array[ 3 * element_index + 1 ] = parseInt( dat[3] );
        element_array[ 3 * element_index + 2 ] = parseInt( dat[4] );

        element_map[ en ] = element_index;

    }

    function post_start () {
        self.postMessage({
            type: 'start'
        });
    }

    function post_progress ( progress ) {
        self.postMessage({
            type: 'progress',
            progress: progress
        });
    }

    function post_finish () {
        self.postMessage({
            type: 'finish'
        });
    }

    function post_elements () {
        var element_map_flat = flatten( element_map, Uint32Array );
        var message = {
            type: 'elements',
            element_array: element_array.buffer,
            element_map: element_map_flat.buffer
        };
        self.postMessage(
            message,
            [ message.element_array, message.element_map ]
        );
    }

    function post_nodes () {
        var node_map_flat = flatten( node_map, Uint32Array );
        var message = {
            type: 'nodes',
            node_array: node_array.buffer,
            node_map: node_map_flat.buffer
        };
        self.postMessage(
            message,
            [ message.node_array, message.node_map ]
        );
    }

    function post_error ( error ) {
        self.postMessage({
            type: 'error',
            error: error.message
        });
    }

}

function fort14_worker () {

    var code = '';
    code += file_reader.toString();
    code += build_fort14_worker.toString();
    code += 'build_fort14_worker();';

    return worker( code );

}

function nest ( flat ) {
    var map = d3.map();
    var num_entries = flat.length/2;
    for ( var i=0; i<num_entries; ++i ) {
        map.set( flat[ 2*i ], flat[ 2*i + 1 ] );
    }
    return map;
}

function fort14 () {

    var _worker = fort14_worker();
    var _fort14 = function () {};

    var _elements;
    var _nodes;

    var _on_start = [];
    var _on_progress = [];
    var _on_finish = [];

    var _on_elements = [];
    var _on_nodes = [];

    var _on_start_persist = [];
    var _on_progress_persist = [];
    var _on_finish_persist = [];

    var _on_elements_persist = [];
    var _on_nodes_persist = [];

    _fort14.elements = function ( _ ) {

        // No arguments, return cached data whether it exists or not
        if ( !arguments.length ) return _elements;

        // A callback has been passed
        if ( typeof arguments[0] === 'function' ) {

            // If the user wants the callback to persist, add it to the queue
            if ( arguments.length == 2 && arguments[1] === true ) _on_elements_persist.push( arguments[0] );

            // If we've got cached data, immediately pass data to callback
            if ( _elements ) return _( _elements );

            // We're going to be waiting for data, so if it isn't persisting, add it to the one-off queue
            if ( arguments.length < 2 || arguments[1] !== true ) _on_elements.push( arguments[0] );

            _worker.postMessage({
                type: 'get',
                what: 'elements'
            });

            return _fort14;

        }

        // Data has been passed so cache it
        _elements = _;
        return _fort14;

    };

    _fort14.nodes = function ( _ ) {

        // No arguments, return cached data whether it exists or not
        if ( !arguments.length ) return _nodes;

        // A callback has been passed
        if ( typeof arguments[0] === 'function' ) {

            // If the user wants the callback to persist, add it to the queue
            if ( arguments.length == 2 && arguments[1] === true ) _on_nodes_persist.push( arguments[0] );

            // If we've got cached data, immediately pass data to callback
            if ( _nodes ) return _( _nodes );

            // We're going to be waiting for data, so if it isn't persisting, add it to the one-off queue
            if ( arguments.length < 2 || arguments[1] !== true ) _on_nodes.push( arguments[0] );

            _worker.postMessage({
                type: 'get',
                what: 'nodes'
            });

            return _fort14;

        }

        // Data has been passed so cache it
        _nodes = _;
        return _fort14;
    };

    _fort14.on_finish = function ( _ ) {
        if ( !arguments.length ) return _on_finish;
        if ( typeof arguments[0] === 'function' ) {
            if ( arguments.length == 1 ) _on_finish.push( arguments[0] );
            if ( arguments.length == 2 && arguments[1] === true ) _on_finish_persist.push( arguments[0] );
        }
        return _fort14;
    };

    _fort14.on_progress = function ( _ ) {
        if ( !arguments.length ) return _on_progress;
        if ( typeof arguments[0] == 'function' ) {
            if ( arguments.length == 1 ) _on_progress.push( arguments[0] );
            if ( arguments.length == 2 && arguments[1] === true ) _on_progress_persist.push( arguments[0] );
        }
        return _fort14;
    };

    _fort14.on_start = function ( _ ) {
        if ( !arguments.length ) return _on_start;
        if ( typeof arguments[0] == 'function' ) {
            if ( arguments.length == 1 ) _on_start.push( arguments[0] );
            if ( arguments.length == 2 && arguments[1] === true ) _on_start_persist.push( arguments[0] );
        }
        return _fort14;
    };

    _fort14.read = function ( file ) {
        _worker.postMessage({
            type: 'read',
            file: file
        });
    };

    _worker.addEventListener( 'message', function ( message ) {

        message = message.data;

        switch ( message.type ) {

            case 'start':
                for ( var i=0; i<_on_start_persist.length; ++i ) _on_start_persist[i]();
                var cb;
                while( ( cb = _on_start.shift() ) !== undefined ) cb();
                break;

            case 'progress':
                for ( var i=0; i<_on_progress_persist.length; ++i ) _on_progress_persist[i]( message.progress );
                var cb;
                while( ( cb = _on_progress.shift() ) !== undefined ) cb( message.progress );
                break;

            case 'finish':
                for ( var i=0; i<_on_finish_persist.length; ++i ) _on_finish_persist[i]();
                var cb;
                while( ( cb = _on_finish.shift() ) !== undefined ) cb();
                break;

            case 'nodes':
                _nodes = {
                    array: new Float32Array( message.node_array ),
                    map: nest( new Uint32Array( message.node_map ) )
                };
                for ( var i=0; i<_on_nodes_persist.length; ++i ) _on_nodes_persist[i]( _nodes );
                var cb;
                while ( ( cb = _on_nodes.shift() ) !== undefined ) cb( _nodes );
                break;

            case 'elements':
                _elements = {
                    array: new Uint32Array( message.element_array ),
                    map: nest( new Uint32Array( message.element_map ) )
                };
                for ( var i=0; i<_on_elements_persist.length; ++i ) _on_elements_persist[i]( _nodes );
                var cb;
                while( ( cb = _on_elements.shift() ) !== undefined ) cb( _elements );
                break;
        }

    });

    return _fort14;

}

function build_fortnd_worker () {

    var reader;
    var file_size;

    var agrid;
    var info_line;
    var n_dims;
    var num_datasets;
    var num_nodes;
    var ts;             // timestep in seconds
    var ts_interval;    // timestep interval (ie. written out every ts_interval timesteps)

    var timestep_map = {};
    var timesteps = [];

    self.addEventListener( 'message', function ( message ) {

        message = message.data;

        switch ( message.type ) {

            case 'n_dims':

                n_dims = message.n_dims;
                break;

            case 'read':

                map_file( message.file );
                break;

            case 'timestep':

                load_timestep( message.timestep_index );
                break;

        }

    });

    function load_timestep ( timestep_index ) {

        if ( timestep_index < num_datasets ) {

            // Get file location from mapping
            var timestep = timesteps[ timestep_index ];
            var start = timestep_map[ timestep ];
            var end = timestep_index == num_datasets - 1 ? file_size : timestep_map[ timesteps[ timestep_index + 1 ] ];

            var bytes = end - start;
            console.log( bytes + ' bytes' );

            var t0 = performance.now();
            reader.read_block(
                start,
                end,
                function ( data ) {
                    var t1 = performance.now();
                    var length = data.length;
                    console.log( 'Read ' + length + ' bytes in ' + ( t1 - t0 ) + ' milliseconds' );
                }
            );

        }

    }

    function map_file ( file ) {

        // Store the file size for progress things
        file_size = file.size;

        post_start();

        // Create the file reader
        reader = file_reader( file )
            .error_callback( on_error );

        // Parse the file header
        reader.read_block( 0, 1024, parse_header );

    }

    function map_timesteps () {

        var header_found = false;
        var next_timestep = 0;
        var next_header = timesteps[ next_timestep ];
        var next_location = 0;

        // Start things off
        reader.read_block(
            next_location,
            next_location + 1024,
            parse_block
        );

        function parse_block ( data ) {

            var regex_line = /.*\r?\n/g;
            var regex_nonwhite = /\S+/g;
            var match;

            if ( header_found === false ) {

                while ( ( match = regex_line.exec( data ) ) !== null ) {

                    var dat = match[ 0 ].match( regex_nonwhite );

                    if ( dat.length >= 2 ) {

                        var test_ts = parseInt( dat[ 1 ] );
                        if ( test_ts == next_header ) {

                            // Set flag that allows us to continue
                            header_found = true;

                            // Store the mapped location
                            timestep_map[ next_header ] = next_location + match.index;

                            // Set the next location, which is the first node of the timestep
                            next_location = next_location + regex_line.lastIndex;

                            // Increment to the next timestep
                            next_timestep += 1;

                            // Post progress
                            post_progress( 100 * ( next_timestep / num_datasets ) );

                            // Determine if we need to continue
                            if ( next_timestep < num_datasets ) {

                                next_header = timesteps[ next_timestep ];
                                reader.read_block(
                                    next_location,
                                    next_location + 1024,
                                    parse_block
                                );

                            } else {

                                post_finish();

                            }
                        }
                    }
                }
            }

            else {

                match = regex_line.exec( data );
                next_location = next_location + num_nodes * match[0].length;

                header_found = false;

                reader.read_block(
                    next_location,
                    next_location + 1024,
                    parse_block
                );

            }
        }
    }

    function parse_header ( data ) {

        // Regexes
        var regex_line = /.*\r?\n/g;
        var regex_nonwhite = /\S+/g;

        // Get the first line
        var match = regex_line.exec( data );

        if ( match !== null ) {

            agrid = match[0];

            // Get the second line
            match = regex_line.exec( data );

            if ( match !== null ) {

                info_line = match[0];

                var info = info_line.match( regex_nonwhite );
                num_datasets = parseInt( info[0] );
                num_nodes = parseInt( info[1] );
                ts_interval = parseInt( info[3] );
                ts = parseFloat( info[2] ) / ts_interval;

                for ( var i=0; i<num_datasets; ++i ) {
                    timesteps.push( (i+1)*ts_interval );
                }

                // Map the timesteps
                map_timesteps();

            }

        }

    }

    function on_error ( error ) {

        post_error( error );

    }

    function post_start () {
        self.postMessage({
            type: 'start'
        });
    }

    function post_progress ( progress ) {
        self.postMessage({
            type: 'progress',
            progress: progress
        });
    }

    function post_finish () {
        self.postMessage({
            type: 'finish'
        });
    }

    function post_error ( error ) {
        self.postMessage({
            type: 'error',
            error: error.message
        });
    }

}

function fortnd_worker () {

    var code = '';
    code += file_reader.toString();
    code += build_fortnd_worker.toString();
    code += 'build_fortnd_worker();';

    return worker( code );

}

function fortnd ( n_dims ) {

    var _n_dims = n_dims;
    var _worker = fortnd_worker();
    var _fortndworker = function () {};

    var _on_start;
    var _on_progress;
    var _on_finish;

    var _timestep_callbacks = {};

    _fortndworker.load_timestep = function ( timestep_index, callback ) {
        _timestep_callbacks[ timestep_index ] = callback;
        _worker.postMessage({
            type: 'timestep',
            timestep_index: timestep_index
        });
        return _fortndworker;
    };

    _fortndworker.on_finish = function ( _ ) {
        if ( !arguments.length ) return _on_finish;
        if ( typeof _ == 'function' ) _on_finish = _;
        return _fortndworker;
    };

    _fortndworker.on_progress = function ( _ ) {
        if ( !arguments.length ) return _on_progress;
        if ( typeof _ == 'function' ) _on_progress = _;
        return _fortndworker;
    };

    _fortndworker.on_start = function ( _ ) {
        if ( !arguments.length ) return _on_start;
        if ( typeof _ == 'function' ) _on_start = _;
        return _fortndworker;
    };

    _fortndworker.read = function ( file ) {
        _worker.postMessage({
            type: 'read',
            file: file
        });
        return _fortndworker;
    };

    _worker.addEventListener( 'message', function ( message ) {

        message = message.data;

        switch ( message.type ) {

            case 'start':
                if ( _on_start ) _on_start();
                break;

            case 'progress':
                if ( _on_progress ) _on_progress( message.progress );
                break;

            case 'finish':
                if ( _on_finish ) _on_finish();
                break;

            case 'timestep':
                if ( message.timestep_index in _timestep_callbacks ) {
                    _timestep_callbacks[ message.timestep_index ]( message.data );
                }

        }

    });

    _worker.postMessage({ type: 'n_dims', n_dims: _n_dims });

    return _fortndworker;

}

function fort63 () {
    return fortnd( 1 );
}

function fort64() {
    return fortnd( 2 );
}

function gl_extensions ( gl ) {

    var extensions = {};

    return {

        get: function ( name ) {

            if ( extensions[ name ] !== undefined ) {

                return extensions[ name ];

            }

            var extension;

            switch ( name ) {

                case 'WEBGL_depth_texture':
                    extension = gl.getExtension( 'WEBGL_depth_texture' ) || gl.getExtension( 'MOZ_WEBGL_depth_texture' ) || gl.getExtension( 'WEBKIT_WEBGL_depth_texture' );
                    break;

                case 'EXT_texture_filter_anisotropic':
                    extension = gl.getExtension( 'EXT_texture_filter_anisotropic' ) || gl.getExtension( 'MOZ_EXT_texture_filter_anisotropic' ) || gl.getExtension( 'WEBKIT_EXT_texture_filter_anisotropic' );
                    break;

                case 'WEBGL_compressed_texture_s3tc':
                    extension = gl.getExtension( 'WEBGL_compressed_texture_s3tc' ) || gl.getExtension( 'MOZ_WEBGL_compressed_texture_s3tc' ) || gl.getExtension( 'WEBKIT_WEBGL_compressed_texture_s3tc' );
                    break;

                case 'WEBGL_compressed_texture_pvrtc':
                    extension = gl.getExtension( 'WEBGL_compressed_texture_pvrtc' ) || gl.getExtension( 'WEBKIT_WEBGL_compressed_texture_pvrtc' );
                    break;

                case 'WEBGL_compressed_texture_etc1':
                    extension = gl.getExtension( 'WEBGL_compressed_texture_etc1' );
                    break;

                default:
                    extension = gl.getExtension( name );

            }

            if ( extension === null ) {

                console.warn( 'WebGL: ' + name + ' extension not supported.' );

            }

            extensions[ name ] = extension;

            return extension;

        }

    };

}

function gl_shader ( gl, type, code, warn_cb, error_cb ) {

    var shader = gl.createShader( type );

    gl.shaderSource( shader, code );
    gl.compileShader( shader );

    if ( gl.getShaderParameter( shader, gl.COMPILE_STATUS ) === false ) {

        var info = gl.getShaderInfoLog( shader );
        if ( !error_cb ) error_cb = console.error;
        error_cb( 'Unable to compile shader' );
        error_cb( info );
        gl.deleteShader( shader );
        return;

    }

    if ( gl.getShaderParameter( shader, gl.COMPILE_STATUS ) === false ) {

        if ( !warn_cb ) warn_cb = console.warn;
        warn_cb( gl.getShaderInfoLog( shader ), add_line_numbers( code ) );

    }

    return shader;

}

function add_line_numbers ( code ) {

    var lines = code.split( '\n' );

    for ( var i = 0; i < lines.length; i ++ ) {

        lines[ i ] = ( i + 1 ) + ': ' + lines[ i ];

    }

    return lines.join( '\n' );

}

function gl_program ( gl, vertex_source, fragment_source, warn_cb, error_cb ) {

    var shader_program = gl.createProgram();
    var vertex_shader = gl_shader( gl, gl.VERTEX_SHADER, vertex_source, warn_cb, error_cb );
    var fragment_shader = gl_shader( gl, gl.FRAGMENT_SHADER, fragment_source, warn_cb, error_cb );

    if ( shader_program && vertex_shader && fragment_shader ) {

        gl.attachShader( shader_program, vertex_shader );
        gl.attachShader( shader_program, fragment_shader );
        gl.linkProgram( shader_program );

        if ( gl.getProgramParameter( shader_program, gl.LINK_STATUS ) === false ) {

            if ( !error_cb ) error_cb = console.error;
            error_cb( gl.getProgramInfoLog( shader_program ) );

        }

        gl.deleteShader( vertex_shader );
        gl.deleteShader( fragment_shader );

        return shader_program;

    }

}

function gradient_shader ( gl, num_colors, min, max ) {

    var _gl = gl;
    var _program = gl_program( _gl, gradient_vertex( num_colors ), gradient_fragment() );
    var _gradient_colors = [];
    var _gradient_stops = [];
    var _wire_color = d3.color( 'black' );
    var _wire_alpha = 0.3;
    var _wire_width = 1.0;

    var min = min || 0;
    var max = max || 1;
    for ( var i=0; i<num_colors; ++i ) {
        _gradient_stops.push( min + ( max-min ) * i/(num_colors-1) );
        _gradient_colors.push( d3.color( d3.schemeCategory20c[i%num_colors] ) );
    }

    _gl.useProgram( _program );

    var _attributes = d3.map({
        'vertex_normal': _gl.getAttribLocation( _program, 'vertex_normal' ),
        'vertex_position': _gl.getAttribLocation( _program, 'vertex_position' )
    });

    var _uniforms = d3.map({
        'gradient_colors': _gl.getUniformLocation( _program, 'gradient_colors' ),
        'gradient_stops': _gl.getUniformLocation( _program, 'gradient_stops' ),
        'projection_matrix': _gl.getUniformLocation( _program, 'projection_matrix' ),
        'wire_alpha': _gl.getUniformLocation( _program, 'wire_alpha' ),
        'wire_color': _gl.getUniformLocation( _program, 'wire_color' ),
        'wire_width': _gl.getUniformLocation( _program, 'wire_width' )
    });

    _program.attribute = function ( attribute ) {
        return _attributes.get( attribute );
    };

    _program.attributes = function ( _ ) {
        if ( !arguments.length ) return _attributes.keys();
        _attributes.each( _ );
        return _program;
    };

    _program.gradient_colors = function ( _ ) {
        if ( !arguments.length ) return _gradient_colors;
        _gradient_colors = _;
        var flattened = _gradient_colors
            .map( function ( color ) { return [ color.r/255, color.g/255, color.b/255 ] } )
            .reduce( function ( a, b ) { return a.concat( b ); }, [] );
        _gl.useProgram( _program );
        _gl.uniform3fv( _program.uniform( 'gradient_colors' ), flattened );
        return _program;
    };

    _program.gradient_stops = function ( _ ) {
        if ( !arguments.length ) return _gradient_stops;
        _gradient_stops = _;
        _gl.useProgram( _program );
        _gl.uniform1fv( _program.uniform( 'gradient_stops' ), _gradient_stops );
        return _program;
    };

    _program.set_projection = function ( matrix ) {
        _gl.useProgram( _program );
        _gl.uniformMatrix4fv( _program.uniform( 'projection_matrix' ), false, matrix );
        return _program;
    };

    _program.wire_alpha = function ( _ ) {
        if ( !arguments.length ) return _wire_alpha;
        _wire_alpha = _;
        _gl.useProgram( _program );
        _gl.uniform1f( _program.uniform( 'wire_alpha' ), _ );
        return _program;
    };

    _program.wire_color = function ( _ ) {
        if ( !arguments.length ) return _wire_color;
        _wire_color = _;
        _gl.useProgram( _program );
        _gl.uniform3fv( _program.uniform( 'wire_color' ), [_.r/255, _.g/255, _.b/255] );
        return _program;
    };

    _program.wire_width = function ( _ ) {
        if ( !arguments.length ) return _wire_width;
        _wire_width = _;
        _gl.useProgram( _program );
        _gl.uniform1f( _program.uniform( 'wire_width' ), _ );
        return _program;
    };

    _program.uniform = function ( uniform ) {
        return _uniforms.get( uniform );
    };

    _program.uniforms = function () {
        return _uniforms.keys();
    };

    _program.use = function () {
        _gl.useProgram( _program );
        return _program;
    };

    return _program
        .gradient_colors( _program.gradient_colors() )
        .gradient_stops( _program.gradient_stops() )
        .wire_alpha( _program.wire_alpha() )
        .wire_color( _program.wire_color() )
        .wire_width( _program.wire_width() );

}

function gradient_vertex ( num_colors ) {

    var code = [
        'attribute vec3 vertex_position;',
        'attribute vec3 vertex_normal;',
        'uniform mat4 projection_matrix;',
        'uniform float gradient_stops[' + num_colors + '];',
        'uniform vec3 gradient_colors[' + num_colors + '];',
        'varying vec3 _vertex_normal;',
        'varying vec3 _vertex_color;',
        'void main() {',
        '  gl_Position = projection_matrix * vec4( vertex_position, 1.0 );',
        '  _vertex_normal = vertex_normal;',
        '  _vertex_color = gradient_colors[0];',
        '  float t;'
    ];

    for ( var i=1; i<num_colors; ++i ) {
        code.push( '  t = clamp((vertex_position.z - gradient_stops['+(i-1)+']) / (gradient_stops['+i+']-gradient_stops['+(i-1)+']), 0.0, 1.0);' );
        code.push( '  _vertex_color = mix( _vertex_color, gradient_colors['+i+'], t*t*(3.0-2.0*t));');
    }

    code.push('}');

    return code.join( '\n' );

}

function gradient_fragment () {

    return [
        '#extension GL_OES_standard_derivatives : enable',
        'precision mediump float;',
        'varying vec3 _vertex_normal;',
        'varying vec3 _vertex_color;',
        'uniform vec3 wire_color;',
        'uniform float wire_alpha;',
        'uniform float wire_width;',
        'float edgeFactorTri() {',
        '   vec3 d = fwidth( _vertex_normal.xyz );',
        '   vec3 a3 = smoothstep( vec3( 0.0 ), d * wire_width, _vertex_normal.xyz );',
        '   return min( min( a3.x, a3.y ), a3.z );',
        '}',
        'void main() {',
        '   vec4 wire = mix( vec4(_vertex_color, 1.0), vec4(wire_color, 1.0), wire_alpha);',
        '   gl_FragColor = mix( wire, vec4(_vertex_color, 1.0), edgeFactorTri() );',
        '}'
    ].join('\n');

}

function m4 () {

    var mat = new Float32Array( 16 ).fill( 0 );
    var tmp = new Float32Array( 16 );
    mat[0] = mat[5] = mat[10] = mat[15] = 1;

    mat.identity = function () {

        mat.fill( 0 );
        mat[0] = mat[5] = mat[10] = mat[15] = 1;

        return mat;

    };

    mat.ortho = function ( left, right, bottom, top, near, far ) {

        mat[0]  = 2 / ( right - left );
        mat[1]  = 0;
        mat[2]  = 0;
        mat[3]  = 0;

        mat[4]  = 0;
        mat[5]  = 2 / (top - bottom);
        mat[6]  = 0;
        mat[7]  = 0;

        mat[8]  = 0;
        mat[9]  = 0;
        mat[10] = -1 / (far - near);
        mat[11] = 0;

        mat[12] = (right + left) / (left - right);
        mat[13] = (top + bottom) / (bottom - top);
        mat[14] = -near / (near - far);
        mat[15] = 1;

        return mat;

    };

    mat.scale = function ( kx, ky, kz ) {

        tmp[ 0] = kx * mat[0];
        tmp[ 1] = kx * mat[1];
        tmp[ 2] = kx * mat[2];
        tmp[ 3] = kx * mat[3];
        tmp[ 4] = ky * mat[4];
        tmp[ 5] = ky * mat[5];
        tmp[ 6] = ky * mat[6];
        tmp[ 7] = ky * mat[7];
        tmp[ 8] = kz * mat[8];
        tmp[ 9] = kz * mat[9];
        tmp[10] = kz * mat[10];
        tmp[11] = kz * mat[11];
        tmp[12] = mat[12];
        tmp[13] = mat[13];
        tmp[14] = mat[14];
        tmp[15] = mat[15];

        fill_mat();

        return mat;

    };

    mat.translate = function ( tx, ty, tz ) {

        fill_tmp();

        tmp[12] = mat[0]*tx + mat[4]*ty + mat[ 8]*tz + mat[12];
        tmp[13] = mat[1]*tx + mat[5]*ty + mat[ 9]*tz + mat[13];
        tmp[14] = mat[2]*tx + mat[6]*ty + mat[10]*tz + mat[14];
        tmp[15] = mat[3]*tx + mat[7]*ty + mat[11]*tz + mat[15];

        return fill_mat();

    };

    function fill_mat () {

        for ( var i=0; i<16; ++i ) {
            mat[i] = tmp[i];
        }

        return mat;

    }

    function fill_tmp () {

        for ( var i=0; i<16; ++i ) {
            tmp[i] = mat[i];
        }

        return tmp;

    }

    return mat;

}

function geometry ( gl, indexed ) {

    var _gl = gl;
    var _indexed = indexed || false;

    var _buffers = d3.map();

    var _bounding_box;
    var _num_elements;
    var _num_nodes;

    function _geometry ( mesh ) {

        _bounding_box = mesh.bounding_box();

        var _nodes = mesh.nodes();
        var _elements = mesh.elements();

        _num_elements = _elements.array.length;

        if ( !_indexed ) {

            _num_nodes = 3 * _num_elements;

            var _node_array = new Float32Array( _num_nodes );

            for ( var i=0; i<_num_elements; ++i ) {

                var node_number = _elements.array[ i ];
                var node_index = _nodes.map.get( node_number );

                _node_array[ 3*i ] = _nodes.array[ 3*node_index ];
                _node_array[ 3*i + 1 ] = _nodes.array[ 3*node_index + 1 ];
                _node_array[ 3*i + 2 ] = _nodes.array[ 3*node_index + 2 ];

            }

            var _vertex_buffer = _gl.createBuffer();
            _gl.bindBuffer( _gl.ARRAY_BUFFER, _vertex_buffer );
            _gl.bufferData( _gl.ARRAY_BUFFER, _node_array, _gl.STATIC_DRAW );

        } else {

            _num_nodes = _nodes.array.length;

            var _element_array = new Uint32Array( _num_elements );
            for ( var i=0; i<_num_elements; ++i ) {

                var node_number = _elements.array[ i ];
                _element_array[ i ] = _nodes.map.get( node_number );

            }

            var _vertex_buffer = _gl.createBuffer();
            _gl.bindBuffer( _gl.ARRAY_BUFFER, _vertex_buffer );
            _gl.bufferData( _gl.ARRAY_BUFFER, _nodes.array, _gl.STATIC_DRAW );

            var _element_buffer = _gl.createBuffer();
            _gl.bindBuffer( _gl.ELEMENT_ARRAY_BUFFER, _element_buffer );
            _gl.bufferData( _gl.ELEMENT_ARRAY_BUFFER, _element_array, _gl.STATIC_DRAW );

            _buffers.set( 'element_array', {
                buffer: _element_buffer
            });

        }

        _buffers.set( 'vertex_position', {
            buffer: _vertex_buffer,
            size: 3,
            type: _gl.FLOAT,
            normalized: false,
            stride: 0,
            offset: 0
        });

        return _geometry;

    }

    _geometry.bind_buffer = function ( attribute ) {
        var buffer = _buffers.get( attribute );
        _gl.bindBuffer( _gl.ARRAY_BUFFER, buffer.buffer );
        return buffer;
    };

    _geometry.bind_element_array = function () {

        var buffer = _buffers.get( 'element_array' );
        _gl.bindBuffer( _gl.ELEMENT_ARRAY_BUFFER, buffer.buffer );
        return _geometry;

    };

    _geometry.bounding_box = function () {
        return _bounding_box;
    };

    _geometry.indexed = function () {
        return _indexed;
    };

    _geometry.num_elements = function () {
        return _num_elements;
    };

    _geometry.num_nodes = function () {
        return _num_nodes;
    };

    _geometry.request_vertex_attribute = function ( attribute ) {

        switch( attribute ) {

            case 'vertex_normal':
                var normals = build_vertex_normals();
                var buffer = _gl.createBuffer();
                _gl.bindBuffer( _gl.ARRAY_BUFFER, buffer );
                _gl.bufferData( _gl.ARRAY_BUFFER, normals, _gl.STATIC_DRAW );
                _buffers.set( 'vertex_normal', {
                    buffer: buffer,
                    size: 3,
                    type: _gl.FLOAT,
                    normalized: false,
                    stride: 0,
                    offset: 0
                });
                break;

            case 'vertex_position':
                break;

            default:
                console.warn( attribute + ' attribute not supported' );

        }

    };


    return _geometry;


    function build_vertex_normals () {

        if ( !_indexed ) {

            var _vertex_normals = new Float32Array( _num_nodes );
            _vertex_normals.fill( 0 );
            for ( var i=0; i<_num_nodes/9; ++i ) {
                _vertex_normals[ 9 * i ] = 1;
                _vertex_normals[ 9 * i + 4 ] = 1;
                _vertex_normals[ 9 * i + 8 ] = 1;
            }

            return _vertex_normals;

        }

        console.error( 'You shouldn\'t be making vertex normals for indexed arrays' );

    }

}

function view ( gl ) {

    var _gl = gl;
    var _geometry;
    var _shader;

    function _view ( geometry, shader ) {

        _geometry = geometry;
        _shader = shader;

        _shader.attributes( function ( attribute, key ) {
            _geometry.request_vertex_attribute( key );
        });

        return _view;

    }

    _view.bounding_box = function () {
        if ( _geometry ) return _geometry.bounding_box();
        return [[null,null,null], [null,null,null]];
    };

    _view.render = function () {

        if ( _geometry && _shader ) {

            _shader.use();

            _shader.attributes( function ( attribute, key ) {

                var buffer = _geometry.bind_buffer( key );
                _gl.vertexAttribPointer( attribute, buffer.size, buffer.type, buffer.normalized, buffer.stride, buffer.offset );
                _gl.enableVertexAttribArray( attribute );

            });

            if ( _geometry.indexed() ) {

                _geometry.bind_element_array();
                _gl.drawElements(
                    _gl.TRIANGLES,
                    _geometry.num_elements() * 3,
                    _gl.UNSIGNED_INT,
                    0
                );

            } else {

                _gl.drawArrays( _gl.TRIANGLES, 0, _geometry.num_nodes()/3 );

            }

        }

        return _view;

    };

    _view.geometry = function () {
        return _geometry;
    };

    _view.shader = function () {
        return _shader;
    };

    return _view;

}

function gl_renderer () {

    var _gl,
        _extensions;

    var _needs_render = true;

    var _canvas,
        _width = 300,
        _height = 150,
        _pixel_ratio = 1;

    var _selection,
        _zoom = d3.zoom().on( 'zoom', zoomed );

    var _projection_matrix = m4();

    var _clear_color = d3.color( '#666666' );

    var _on_context_lost,
        _on_error;

    var _views = [];

    function _renderer ( canvas ) {

        // Keep local reference to the canvas
        _canvas = canvas;
        _selection = d3.select( _canvas );

        // Verify webgl availability
        if ( !web_gl_available( canvas ) ) {
            if ( _on_error ) _on_error ( 'WebGL not supported' );
            return;
        }

        var _attributes = {
            alpha: false,
            antialias: false,
            premultipliedAlpha: false,
            stencil: true
        };

        // Acquire the webgl context
        _gl = _canvas.getContext( 'webgl', _attributes ) || _canvas.getContext( 'experimental-webgl', _attributes );

        if ( _gl === null ) {
            if ( _on_error ) _on_error ( 'Error creating WebGL context' );
            return;
        }

        // Connect any existing event listeners
        if ( _on_context_lost ) _canvas.addEventListener( 'webglcontextlost', _on_context_lost, false );

        // Load extensions
        _extensions = gl_extensions( _gl );
        _extensions.get( 'ANGLE_instanced_arrays' );
        _extensions.get( 'OES_element_index_uint' );
        _extensions.get( 'OES_standard_derivatives' );

        // Set up the renderer
        _renderer.clear_color( _renderer.clear_color() );
        check_render();

        // Set up interactivity
        _selection.call( _zoom );

        return _renderer;

    }

    _renderer.add_mesh = function ( m ) {

        var geo = geometry( _gl )( m );
        // var shader = basic_shader( _gl );
        // var shader = gradient_shader( _gl, 3 ).wire_alpha( 0.3 ).wire_width( 1.0 );
        var shader = gradient_shader( _gl, 10, geo.bounding_box()[0][2], geo.bounding_box()[1][2] );
        //     .set_gradient( [ 0, 0.5, 1 ], [ d3.color('steelblue'), d3.color('white'), d3.color('green') ] )
        //     .wire_color( d3.color( 'black' ) )
        //     .set_wire_alpha( 0.25 )
        //     .set_wire_width( 2.5 );
        var vew = view( _gl );

        _views.push( vew( geo, shader ) );

        update_projection();

        return _renderer.render();

    };

    _renderer.clear_color = function (_) {
        if ( !arguments.length ) return _clear_color;
        if ( arguments.length == 1 ) _clear_color = _;
        if ( arguments.length == 3 ) _clear_color = d3.rgb( arguments[0], arguments[1], arguments[2] );
        if ( arguments.length == 4 ) _clear_color = d3.rgb( arguments[0], arguments[1], arguments[2], arguments[3] );
        if ( _gl && _clear_color ) {
            _gl.clearColor(
                _clear_color.r / 255,
                _clear_color.g / 255,
                _clear_color.b / 255,
                _clear_color.opacity
            );
            _renderer.render();
        }
        return _renderer;
    };

    _renderer.context = function (_) {
        if ( !arguments.length ) return _gl;
        _gl = _;
        return _renderer;
    };

    _renderer.on_context_lost = function (_) {
        if ( !arguments.length ) return _on_context_lost;
        if ( typeof _ === 'function' ) _on_context_lost = _;
        return _renderer;
    };

    _renderer.on_error = function (_) {
        if ( !arguments.length ) return _on_error;
        if ( typeof _ === 'function' ) _on_error = _;
        return _renderer;
    };

    _renderer.render = function () {

        _needs_render = true;
        return _renderer;

    };

    _renderer.zoom_to = function (_) {

        if ( !arguments.length ) return _renderer;

        var bounds = _.bounding_box();
        var duration = 0;
        var dx = bounds[1][0] - bounds[0][0],
            dy = bounds[1][1] - bounds[0][1],
            x = (bounds[0][0] + bounds[1][0]) / 2,
            y = _height - (bounds[0][1] + bounds[1][1]) / 2,
            scale = 0.9 / Math.max( dx / _width, dy / _height ),
            translate = [ _width / 2 - scale * x, _height / 2 - scale * y];

        if ( arguments.length == 2 )
            duration = arguments[1];

        _selection
            .transition()
            .duration( duration )
            .call(
                _zoom.transform,
                d3.zoomIdentity
                    .translate( translate[0], translate[1] )
                    .scale( scale )
            );

    };


    return _renderer;

    function check_render () {

        if ( resize() || _needs_render ) {

            _needs_render = false;
            render();

        }

        requestAnimationFrame( check_render );

    }

    function render () {

        _gl.clear( _gl.COLOR_BUFFER_BIT | _gl.DEPTH_BUFFER_BIT );

        for ( var i=0; i<_views.length; ++i ) {
            _views[i].render();
        }

    }

    function resize () {

        if ( _canvas.clientWidth != _width || _canvas.clientHeight != _height ) {

            _width = _canvas.clientWidth;
            _height = _canvas.clientHeight;
            _canvas.width = _width * _pixel_ratio;
            _canvas.height = _height * _pixel_ratio;
            _gl.viewport( 0, 0, _width, _height );
            update_projection();
            return true;

        }

        return false;

    }

    function update_projection ( k, tx, ty ) {

        if ( !arguments.length ) {
            var t = d3.zoomTransform( _canvas );
            return update_projection( t.k, t.x, t.y );
        }

        _projection_matrix
            .ortho( 0, _width,  _height, 0, -10000, 10000 )
            .translate( tx, ty, 0 )
            .scale( k, -k, 1 )
            .translate( 0, -_height, 0 );

        for ( var i=0; i<_views.length; ++i ) {
            _views[i].shader().set_projection( _projection_matrix );
        }

    }

    function zoomed () {
        var t = d3.event.transform;
        update_projection( t.k, t.x, t.y );
        _renderer.render();
    }
    
}

function web_gl_available ( canvas ) {

    return !! ( window.WebGLRenderingContext && ( canvas.getContext( 'webgl' ) || canvas.getContext( 'experimental-webgl' ) ) );

}

function mesh () {

    var _nodes = { array: [], map: d3.map() };
    var _elements = { array: [], map: d3.map() };

    var _bounding_box;

    function _mesh () {}

    _mesh.bounding_box = function () {
        return _bounding_box;
    };

    _mesh.elements = function (_) {
        if ( !arguments.length ) return _elements;
        if ( _.array && _.map ) {
            _elements = _;
        }
        return _mesh;
    };

    _mesh.element_array = function ( _ ) {
        if ( !arguments.length ) return _elements.array;
        _elements.array = _;
        return _mesh;
    };

    _mesh.element_index = function ( element_number ) {
        return _elements.map.get( element_number );
    };

    _mesh.element_map = function ( _ ) {
        if ( !arguments.length ) return _elements.map;
        _elements.map = _;
        return _mesh;
    };

    _mesh.nodes = function (_) {
        if ( !arguments.length ) return _nodes;
        if ( _.array && _.map ) {
            _nodes = _;
            _bounding_box = calculate_bbox( _nodes.array );
        }
        return _mesh;
    };

    _mesh.node_array = function ( _ ) {
        if ( !arguments.length ) return _nodes.array;
        _nodes.array = _;
        calculate_bbox( _mesh.node_array() );
        return _mesh;
    };

    _mesh.node_index = function ( node_number ) {
        return _nodes.map.get( node_number );
    };

    _mesh.node_map = function ( _ ) {
        if ( !arguments.length ) return _nodes.map;
        _nodes.map = _;
        return _mesh;
    };

    _mesh.num_elements = function () {
        return _elements.array.length / 3;
    };

    _mesh.num_nodes = function () {
        return _nodes.array.length / 3;
    };

    return _mesh;

}

function calculate_bbox ( node_array ) {

    var numnodes = node_array.length/3;
    var minx = Infinity, maxx = -Infinity;
    var miny = Infinity, maxy = -Infinity;
    var minz = Infinity, maxz = -Infinity;
    for ( var i=0; i<numnodes; ++i ) {
        if ( node_array[3*i] < minx ) minx = node_array[3*i];
        else if ( node_array[3*i] > maxx ) maxx = node_array[3*i];
        if ( node_array[3*i+1] < miny ) miny = node_array[3*i+1];
        else if ( node_array[3*i+1] > maxy ) maxy = node_array[3*i+1];
        if ( node_array[3*i+2] < minz ) minz = node_array[3*i+2];
        else if ( node_array[3*i+2] > maxz ) maxz = node_array[3*i+2];
    }
    return [[minx, miny, minz], [maxx, maxy, maxz]];

}

exports.fort14 = fort14;
exports.fort63 = fort63;
exports.fort64 = fort64;
exports.gl_renderer = gl_renderer;
exports.mesh = mesh;

Object.defineProperty(exports, '__esModule', { value: true });

})));
