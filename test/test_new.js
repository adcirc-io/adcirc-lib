
var canvas = d3.select( '#canvas' );
var renderer = adcirc.gl_renderer()( canvas.node() );

var num_ts = 187;

var progress = progress_bar().height( 2 );
var slide = slider().count( num_ts );
var f14_picker = button( 'Choose fort.14' ).file_picker( on_f14 );
var f63_picker = button( 'Choose fort.63' ).file_picker( on_f63 );
var f64_picker = button( 'Choose fort.64' );
var residual_picker = button( 'Choose Residuals' ).file_picker( on_residual );

progress( d3.select( '#progress' ) );
slide( d3.select( '#slider' ) );
f14_picker( d3.select( '#f14' ) );
f63_picker( d3.select( '#f63' ) );
f64_picker( d3.select( '#f64' ) );
residual_picker( d3.select( '#residual' ) );

var mesh = adcirc.mesh();
var shader;

function on_f14 ( file ) {

    var f14 = adcirc.fort14()
        .on( 'start', progress.event )
        .on( 'progress', progress.event )
        .on( 'finish', progress.event )
        .on( 'nodes', function( event ) {
            mesh.nodes( event.nodes );
        })
        .on( 'elements', function ( event ) {
            mesh.elements( event.elements );
        })
        .on( 'ready', display_mesh )
        .read( file );

}

function on_f63 ( file ) {

    var f63 = adcirc.fort63()
        .on( 'start', progress.event )
        .on( 'progress', progress.event )
        .on( 'finish', progress.event )
        .on( 'ready', function () {
            cache_left.range( [0, 20] );
            cache_right.range( [20, 40] );
        });

    var cache_left = adcirc.cache()
        .size( 20 )
        .max_size( num_ts )
        .getter( getter )
        .once( 'ready', function () {
            console.log( 'Left loaded' );
            gl_cache.range( [0, 1] );
        });

    var cache_right = adcirc.cache()
        .size( 20 )
        .max_size( num_ts )
        .getter( getter )
        .once( 'ready', function () {
            console.log( 'Right loaded' );
        });

    var gl_cache = adcirc.cache()
        .size( 1 )
        .max_size( num_ts )
        .cache_left( cache_left )
        .cache_right( cache_right )
        .transform( function ( index, data ) {

            mesh.nodal_value( 'depth', data.data() );
            set_range( data.data_range() );
            return [index];

        })
        .once( 'ready', function () {
            console.log( 'GL loaded' );
        });

    f63.read( file );

    var current = 0;

    d3.select( 'body' ).on( 'keydown', function () {
        switch ( d3.event.key ) {
            case 'ArrowRight':
                if ( current + 1 < num_ts ) {
                    var data = gl_cache.get( current + 1 );
                    if ( typeof data !== 'undefined' ) {
                        current = current + 1;
                        slide.current( current );
                    }
                }
                break;
            case 'ArrowLeft':
                if ( current - 1 >= 0 ) {
                    var data = gl_cache.get( current - 1 );
                    if ( typeof data !== 'undefined'  ) {
                        current = current - 1;
                        slide.current( current );
                    }
                }
                break;
        }
    });

    function getter ( index, callback ) {

        f63.timestep( index, function ( event ) {

            callback( index, event.timestep );

        });

    }


}

function on_residual ( file ) {

    var f63 = adcirc.fort63()
        .on( 'start', progress.event )
        .on( 'progress', progress.event )
        .on( 'finish', progress.event )
        .on( 'ready', function () {
            cache_left.range( [0, 20] );
            cache_right.range( [20, 187] );
        });

    var cache_left = adcirc.cache()
        .size( 20 )
        .max_size( num_ts )
        .getter( getter )
        .once( 'ready', function () {
            console.log( 'Left loaded' );
            gl_cache.range( [0, 1] );
        });

    var cache_right = adcirc.cache()
        .size( 167 )
        .max_size( num_ts )
        .getter( getter )
        .once( 'ready', function () {
            console.log( 'Right loaded' );
        });

    var gl_cache = adcirc.cache()
        .size( 1 )
        .max_size( num_ts )
        .cache_left( cache_left )
        .cache_right( cache_right )
        .transform( function ( index, data ) {

            console.log( data.index(), data.model_time(), data.model_timestep() );
            mesh.elemental_value( 'residual', data.data() );
            // var r = data.data_range()[0];
            // var range = [ [r[0]/2, r[1]/2] ];
            // set_range( range );
            return [index];

        })
        .once( 'ready', function () {
            console.log( 'GL loaded' );
        });

    f63.read( file );

    var current = 0;

    d3.select( 'body' ).on( 'keydown', function () {
        switch ( d3.event.key ) {
            case 'ArrowRight':
                if ( current + 1 < num_ts ) {
                    var data = gl_cache.get( current + 1 );
                    if ( typeof data !== 'undefined' ) {
                        current = current + 1;
                        slide.current( current );
                    }
                }
                break;
            case 'ArrowLeft':
                if ( current - 1 >= 0 ) {
                    var data = gl_cache.get( current - 1 );
                    if ( typeof data !== 'undefined'  ) {
                        current = current - 1;
                        slide.current( current );
                    }
                }
                break;
        }
    });

    function getter ( index, callback ) {

        f63.timestep( index, function ( event ) {

            callback( index, event.timestep );

        });

    }

}

function set_range ( range ) {

    var dim = range[0];
    var min = dim[0];
    var max = dim[1];
    var mid = ( max + min ) / 2;

    shader.gradient_stops( [ min, mid, max ] );

}

function display_mesh () {

    if ( !mesh.num_nodes() || !mesh.num_elements() ) {
        return;
    }

    var geometry = adcirc.geometry( renderer.gl_context() )
        .nodal_value( 'depth' )
        .elemental_value( 'residual' )
        .mesh( mesh );

    shader = adcirc
        .gradient_shader( renderer.gl_context(), 3 )
        .gradient_stops( [-0.015, 0.0, 0.01] )
        .gradient_colors([
            d3.color( 'steelblue' ),
            d3.color( 'lightgreen' ),
            d3.color( 'orangered' )
        ]);

    var view = adcirc.view( renderer.gl_context() );

    renderer
        .add_view( view( geometry, shader ) )
        .zoom_to( mesh, 500 );

}