
var canvas = d3.select( '#canvas' );
var renderer = adcirc.gl_renderer()( canvas.node() );

var progress = progress_bar().height( 2 );
var slide = slider();
var f14_picker = button( 'Choose fort.14' ).file_picker( on_f14 );
var f63_picker = button( 'Choose fort.63' ).file_picker( on_f63 );
var f64_picker = button( 'Choose fort.64' );

progress( d3.select( '#progress' ) );
slide( d3.select( '#slider' ) );
f14_picker( d3.select( '#f14' ) );
f63_picker( d3.select( '#f63' ) );
f64_picker( d3.select( '#f64' ) );

var mesh = adcirc.mesh();

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
        .max_size( 50 )
        .getter( getter )
        .once( 'ready', function () {
            console.log( 'Left loaded' );
            gl_cache.range( [0, 1] );
            cache_left.print();
        });

    var cache_right = adcirc.cache()
        .size( 20 )
        .max_size( 50 )
        .getter( getter )
        .once( 'ready', function () {
            cache_right.print();
        });

    var gl_cache = adcirc.cache()
        .size( 1 )
        .max_size( 50 )
        .cache_left( cache_left )
        .cache_right( cache_right )
        .transform( function ( index, data ) {

            console.log( data );
            mesh.nodal_value( 'depth', data );

        })
        .once( 'ready', function () {
            gl_cache.print();
        });

    f63.read( file );

    var current = 0;

    d3.select( 'body' ).on( 'keydown', function () {
        switch ( d3.event.key ) {
            case 'ArrowRight':
                if ( current + 1 < 50 ) gl_cache.get( ++current );
                break;
            case 'ArrowLeft':
                if ( current - 1 >= 0 ) gl_cache.get( --current );
                break;
        }
    });

    function getter ( index, callback ) {

        f63.timestep( index, function ( event ) {

            callback( index, event.timestep.data() );

        });

    }


}

function display_mesh () {

    if ( !mesh.num_nodes() || !mesh.num_elements() ) {
        return;
    }

    var geometry = adcirc.geometry( renderer.gl_context() )
        .nodal_value( 'depth' )
        .mesh( mesh );

    var shader = adcirc
        .gradient_shader( renderer.gl_context(), 4 )
        .gradient_stops( [0.1, 0.025, -0.025, -0.1] )
        .gradient_colors([
            d3.color( 'dodgerblue' ),
            d3.color( 'lightskyblue' ),
            d3.color( 'lightgreen' ),
            d3.color( 'forestgreen' )
        ]);

    var view = adcirc.view( renderer.gl_context() );

    renderer
        .add_view( view( geometry, shader ) )
        .zoom_to( mesh, 500 );

}